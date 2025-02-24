import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Device } from '@twilio/voice-sdk';
import io from 'socket.io-client';
import axios from 'axios';
import './App.css';
import {FiPhoneCall, FiPhone } from "react-icons/fi";
import { FaPhoneAlt, FaEdit } from 'react-icons/fa';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import { AuthProvider } from './context/AuthContext';

const NotificationSound = ({ play }) => {
    useEffect(() => {
        if (play) {
            try {
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator1 = audioContext.createOscillator();
                const oscillator2 = audioContext.createOscillator();
                const gainNode = audioContext.createGain();

                // Connect nodes
                oscillator1.connect(gainNode);
                oscillator2.connect(gainNode);
                gainNode.connect(audioContext.destination);

                // Configure oscillators for a phone-like ring
                oscillator1.type = 'sine';
                oscillator1.frequency.setValueAtTime(880, audioContext.currentTime); // A5 note
                oscillator2.type = 'sine';
                oscillator2.frequency.setValueAtTime(1109, audioContext.currentTime); // C#6 note

                // Configure gain envelope
                gainNode.gain.setValueAtTime(0, audioContext.currentTime);
                gainNode.gain.linearRampToValueAtTime(0.2, audioContext.currentTime + 0.05);
                gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.4);

                // Start and stop
                oscillator1.start(audioContext.currentTime);
                oscillator2.start(audioContext.currentTime);
                oscillator1.stop(audioContext.currentTime + 0.4);
                oscillator2.stop(audioContext.currentTime + 0.4);

                // Cleanup
                setTimeout(() => {
                    audioContext.close();
                }, 500);
            } catch (error) {
                console.error('Error playing notification:', error);
            }
        }
    }, [play]);

    return null;
};

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';
const TWILIO_PHONE = process.env.REACT_APP_TWILIO_PHONE_NUMBER;

// Configure axios instance
const api = axios.create({
    baseURL: API_URL,
    withCredentials: true,
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    }
});

// Initialize socket connection
const socket = io(API_URL, {
    transports: ['websocket'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 5
});

// Dialpad configuration
const dialpadConfig = [
    { number: '1', letters: '' },
    { number: '2', letters: 'ABC' },
    { number: '3', letters: 'DEF' },
    { number: '4', letters: 'GHI' },
    { number: '5', letters: 'JKL' },
    { number: '6', letters: 'MNO' },
    { number: '7', letters: 'PQRS' },
    { number: '8', letters: 'TUV' },
    { number: '9', letters: 'WXYZ' },
    { number: '*', letters: '' },
    { number: '0', letters: '+' },
    { number: '#', letters: '' }
];

function App() {
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [file, setFile] = useState(null);
    const [phoneNumber, setPhoneNumber] = useState('');
    const [calls, setCalls] = useState([]);
    const [activeCall, setActiveCall] = useState(null);
    const [callHistory, setCallHistory] = useState([]);
    const [socketConnected, setSocketConnected] = useState(false);
    const [agentStatus, setAgentStatus] = useState('available');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState('dialer');
    const [callTimer, setCallTimer] = useState(0);
    const [device, setDevice] = useState(null);
    const [currentConnection, setCurrentConnection] = useState(null);
    const [isCalling, setIsCalling] = useState(false);
    const [incomingCall, setIncomingCall] = useState(null);
    const [shouldPlaySound, setShouldPlaySound] = useState(false);
    const [showLeadsTable, setShowLeadsTable] = useState(false);
    const [leads, setLeads] = useState();
    const [totalLeads, setTotalLeads] = useState();
    const [currentPage, setCurrentPage] = useState(1);
    const [recordsPerPage, setRecordsPerPage] = useState(10);
    const [totalPages, setTotalPages] = useState(5);
    const [selectedLeads, setSelectedLeads] = useState([]);
    const [editingLead, setEditingLead] = useState(null);

    const handleFileUpload = async () => {
        console.log('📁 File selected:', file);
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        try {
            await axios.post(`${process.env.REACT_APP_API_URL}/api/leads/import`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });
            setShowUploadModal(false);
            fetchLeads();
        } catch (error) {
            setError('Failed to upload file');
        }
    };
    const fetchLeads = async () => {
        try {
            setLoading(true);
            const { data } = await axios.get(`${process.env.REACT_APP_API_URL}/api/leads?page=${currentPage}&limit=${recordsPerPage}`, {
                headers: { 'ngrok-skip-browser-warning': 'true' }
            });
            console.log(data);
            setLeads(data.leads);
            setTotalLeads(data.total);
            setTotalPages(data.totalPages);
        } catch (error) {
            setError('Failed to fetch leads');
        } finally {
            setLoading(false);
        }
    };

    // Refs
    const soundIntervalRef = useRef(null);
    const timerRef = useRef(null);
    useEffect(() => {
        console.log('🔄 Setting up WebSocket event listeners...');

        const handleMobileCallEnd = (data) => {
            console.log('🔴 Call ended event received from server:', data);

            // 🔴 Ensure WebRTC is fully disconnected
            if (currentConnection) {
                console.log('🔴 Disconnecting WebRTC...');
                currentConnection.disconnect();
                setCurrentConnection(null);
            }

            // 🛑 Destroy Twilio Device
            if (device) {
                console.log('🛑 Destroying Twilio Device...');
                device.destroy();
                setDevice(null);
            }

            // ✅ **STOP THE NOTIFICATION SOUND**
            stopNotificationSound();

            // ✅ **CLEAR CALL STATES**
            setIncomingCall(null);
            setActiveCall(null);
            setIsCalling(false);

            // ✅ **STOP TIMER**
            stopTimer();

            // ✅ **UPDATE CALL HISTORY (remove ringing status)**
            setCallHistory((prev) =>
                prev?.map(call =>
                    call.callId === data.callSid ? { ...call, status: 'completed' } : call
                )
            );
        };

        // Listen for call-ended event from the server
        socket.on('callEnded', handleMobileCallEnd);

        return () => {
            console.log('🧹 Cleaning up WebSocket event listeners...');
            socket.off('callEnded', handleMobileCallEnd);
        };
    }, [currentConnection, device]);

    useEffect(() => {
        console.log('🔄 Setting up socket event listeners...');

        // Handle incoming call
        const handleIncomingCall = (data) => {
            console.log('📞 Incoming call event received:', data);

            if (incomingCall && incomingCall.callSid === data.callSid) {
                console.warn('⚠️ Duplicate incoming call detected. Ignoring.');
                return;
            }


            if (!device) {
                console.error('❌ Device not ready for incoming call');
                return;
            }
            // Start notification sound
            startNotificationSound();
            setIncomingCall(data);


        };

        const handleCallStatus = (data) => {
            console.log('📱 Socket: Call status update received:', data);
            if (data.status === 'in-progress') {
                startTimer();
            } else if (data.status === 'completed' || data.status === 'rejected') {
                stopNotificationSound();
                stopTimer();
                setIncomingCall(null);
                setIsCalling(false);
            }
            updateCallHistory(data);
        };

        // Socket connection events
        socket.on('connect', () => {
            const socketId = socket.id;
            console.log('🟢 Socket connected with ID:', socketId);
            setSocketConnected(true);
        });

        socket.on('disconnect', (reason) => {
            console.log('🔴 Socket disconnected. Reason:', reason);
            setSocketConnected(false);
        });

        socket.on('connect_error', (error) => {
            console.error('❌ Socket connection error:', error);
        });

        socket.on('error', (error) => {
            console.error('❌ Socket error:', error);
        });

        // Bind event handlers
        socket.on('incomingCall', handleIncomingCall);
        socket.on('callStatusUpdated', handleCallStatus);


        // Debug: Log all socket events
        const debugSocket = (eventName, ...args) => {
            console.log(`🔍 Socket Event [${eventName}]:`, ...args);
        };
        socket.onAny(debugSocket);

        // Cleanup
        return () => {
            console.log('🧹 Cleaning up socket event listeners...');
            socket.off('incomingCall', handleIncomingCall);
            socket.off('callStatusUpdated', handleCallStatus);
            socket.off('connect');
            socket.off('disconnect');
            socket.off('connect_error');
            socket.off('error');
            socket.offAny(debugSocket);

            stopNotificationSound();
        };
    }, [device]);
    useEffect(() => {
        if (device) {
            console.log('✅ Device already initialized, skipping setup.');
            return;
        }

        const setupDevice = async () => {
            try {
                console.log('🎯 Setting up Twilio device...');

                const response = await api.get('/api/token', {
                    headers: { 'ngrok-skip-browser-warning': 'true' }
                });

                const token = response.data.token;
                console.log('🎫 Received token:', token);

                const newDevice = new Device(token, {
                    edge: ['ashburn'],
                    enableRingingState: true,
                    debug: true,  // ✅ Enable full debug logs
                    closeProtection: true,
                    codecPreferences: ['opus', 'pcmu'],
                    allowIncomingConnections: true
                });

                newDevice.on('registered', () => {
                    console.log('✅ Device registered with Twilio');
                    setDevice(newDevice);
                });

                newDevice.on('incoming', connection => {
                    console.log('📞 Twilio: Incoming connection received:', connection.parameters);
                    handleIncomingConnection(connection);
                });

                newDevice.on('error', error => {
                    console.error('❌ Twilio device error:', error);
                });

                newDevice.on('connect', connection => {
                    console.log('✅ WebRTC Connection Successful:', connection);
                });

                newDevice.on('disconnect', connection => {
                    console.log('🔴 WebRTC Connection Disconnected:', connection);
                });

                await newDevice.register();
                console.log('🎉 Device setup complete');

            } catch (error) {
                console.error('❌ Error setting up device:', error);
            }
        };

        setupDevice();

        return () => {
            console.log('🧹 Cleaning up Twilio device...');
            if (device) {
                device.destroy();
            }
        };
    }, []);


    useEffect(() => {
        return () => {
            if (currentConnection) {
                currentConnection.disconnect();
                setCurrentConnection(null);
                setIsCalling(false);
            }
        };
    }, [currentConnection]);

    const startNotificationSound = useCallback(() => {
        if (soundIntervalRef.current) {
            clearInterval(soundIntervalRef.current);
        }

        // Initial sound
        setShouldPlaySound(true);

        // Then alternate between on and off with delays
        let isOn = false;
        soundIntervalRef.current = setInterval(() => {
            isOn = !isOn;
            setShouldPlaySound(isOn);
        }, 1500); // Changed to 1.5 seconds for a more natural ring cycle
    }, []);

    const stopNotificationSound = useCallback(() => {
        if (soundIntervalRef.current) {
            clearInterval(soundIntervalRef.current);
            soundIntervalRef.current = null;
        }
        setShouldPlaySound(false);
    }, []);

    const handleIncomingConnection = (connection) => {
        console.log('📞 Handling incoming connection:', connection.parameters);

        try {
            // Start notification sound
            startNotificationSound();

            // Set incoming call state
            const callInfo = {
                callSid: connection.parameters.callSid,
                from: connection.parameters.From,
                conferenceName: connection.parameters.conferenceName || `conf_${connection.parameters.callSid}`,
                status: 'ringing'
            };

            console.log('📝 Setting incoming call info:', callInfo);
            setIncomingCall(callInfo);

        } catch (error) {
            console.error('❌ Error handling incoming connection:', error);
        }
    };

    const handleAcceptCall = async () => {
        console.log(incomingCall);
        if (!incomingCall || !incomingCall.callSid) {
            console.error("❌ Cannot accept call: missing callSid.");
            return;
        }

        try {
            console.log("✅ Accepting call:", incomingCall);

            // 🛠 Resume Audio Context (Fix for muted calls)
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            await audioContext.resume();
            console.log("🎧 AudioContext resumed.");

            // 🔹 1️⃣ Accept call via backend
            const response = await api.post(`/api/calls/accept`, { callSid: incomingCall.callSid });
            if (!response.data.success) {
                throw new Error("❌ Server failed to accept call.");
            }

            // 🔹 2️⃣ Ensure Twilio Device Exists
            if (!device) {
                console.error("❌ No Twilio device available.");
                return;
            }

            // 🔹 3️⃣ Connect to WebRTC
            console.log("📞 Connecting WebRTC to conference:", incomingCall.conferenceName);
            const connection = await device.connect({
                To: incomingCall.conferenceName,
                From: 'client:browser',
                callSid: incomingCall.callSid
            });

            connection.on('accept', () => {
                console.log("✅ Call accepted.");

                // 🛑 **Fix UI State**
                setActiveCall({
                    callSid: incomingCall.callSid,
                    conferenceName: incomingCall.conferenceName,
                    from: incomingCall.from,
                    status: 'in-progress'
                });

                // **Hide Accept/Reject Buttons**
                setIncomingCall(null);

                // Start Timer
                startTimer();
            });

            connection.on('disconnect', () => {
                console.log("📞 Call disconnected.");
                setCurrentConnection(null);
                setActiveCall(null);
                setIsCalling(false);
                stopTimer();
            });

            connection.on('error', (error) => {
                console.error("❌ Connection error:", error);
            });

        } catch (error) {
            console.error("❌ Error accepting call:", error.message);
        }
    };

    const handleCall = async () => {
        if (!phoneNumber || !device || isCalling) return;

        try {
            setIsCalling(true);

            // Step 1: Initiate call via backend
            const response = await api.post('/api/calls/initiate', {
                to: phoneNumber,
                from: TWILIO_PHONE,
            });

            if (!response.data.success) {
                throw new Error('Failed to initiate call.');
            }

            console.log('📞 Call initiated:', response.data.callId);

            // Step 2: Set the active call
            setActiveCall({
                callSid: response.data.callId,
                to: phoneNumber
            });

            // Step 3: Connect using Twilio Device
            const connection = await device.connect({
                To: phoneNumber,
                From: TWILIO_PHONE
            });

            connection.on('accept', () => {
                console.log('✅ Call connected.');
                setCurrentConnection(connection);
            });

            connection.on('disconnect', () => {
                console.log('📞 WebRTC Disconnected Automatically.');
                setCurrentConnection(null);
                setActiveCall(null);
                setIsCalling(false);
            });

            connection.on('error', (error) => {
                console.error('❌ Call connection error:', error);
                setCurrentConnection(null);
                setActiveCall(null);
                setIsCalling(false);
            });

        } catch (error) {
            console.error('❌ Error making call:', error);
            setIsCalling(false);
        }
    };

    const setupTwilioDevice = async () => {
        try {
            console.log('🎯 Setting up Twilio device...');

            // Get new Twilio token
            const response = await api.get('/api/token', {
                headers: { 'ngrok-skip-browser-warning': 'true' }
            });
            const token = response.data.token;
            console.log('🎫 Received new Twilio token');

            // Initialize new Twilio Device
            const newDevice = new Device(token, {
                edge: ['ashburn'],
                enableRingingState: true,
                debug: true,
                closeProtection: true,
                codecPreferences: ['opus', 'pcmu'],
                allowIncomingConnections: true
            });

            newDevice.on('registered', () => {
                console.log('✅ Device registered with Twilio');
                setDevice(newDevice);
            });

            // **Auto-accept calls when they arrive**
            newDevice.on('incoming', connection => {
                console.log('📞 Twilio: Incoming connection received:', connection.parameters);
                connection.accept();  // ✅ Auto-accept call
                setCurrentConnection(connection);
            });

            newDevice.on('error', error => {
                console.error('❌ Twilio device error:', error);
            });

            await newDevice.register();
            console.log('🎉 Device setup complete');

        } catch (error) {
            console.error('❌ Error setting up Twilio device:', error);
        }
    };

    const handleEndCall = async () => {
        console.log('🔴 Ending call...');

        if (!activeCall?.callSid) {
            console.warn('⚠️ No active call to end.');
            return;
        }

        try {
            console.log(`📢 Sending request to end call with CallSid: ${activeCall.callSid}`);

            // Step 1: End the call via API
            await api.post('/api/calls/end', {
                callId: activeCall.callSid,
            });

            console.log('✅ Call ended successfully.');

            // Step 2: Ensure WebRTC connection is fully closed
            if (currentConnection) {
                console.log('🔴 Disconnecting WebRTC...');
                currentConnection.disconnect();
                setCurrentConnection(null);
            }

            console.log('🔄 Restarting WebSocket connection...');
            if (socket) {
                socket.disconnect();
                setTimeout(() => {
                    socket.connect();
                    console.log('✅ WebSocket reconnected.');
                }, 1000);
            }

            // Step 5: Re-initialize Twilio Device immediately
            console.log('🔄 Re-initializing Twilio Device...');
            await setupTwilioDevice();

            // Step 6: Reset call states
            setActiveCall(null);
            setIsCalling(false);


        } catch (error) {
            console.error('❌ Error ending call:', error);
        }
    };


    useEffect(() => {
        return () => {
            if (soundIntervalRef.current) {
                clearInterval(soundIntervalRef.current);
            }
            if (timerRef.current) {
                clearInterval(timerRef.current);
            }
        };
    }, []);

    const updateCallHistory = (data) => {
        const { from, status, callSid } = data;
        setCallHistory(prev => {
            const existingCall = prev.find(call => call.callId === callSid);
            if (existingCall) {
                return prev.map(call =>
                    call.callId === callSid
                        ? { ...call, status }
                        : call
                );
            }
            return [...prev, {
                callId: callSid,
                number: from,
                status,
                timestamp: new Date().toISOString()
            }];
        });
    };

    const startTimer = useCallback(() => {
        console.log('⏱️ Starting call timer');
        if (timerRef.current) {
            clearInterval(timerRef.current);
        }
        setCallTimer(0);
        timerRef.current = setInterval(() => {
            setCallTimer(prev => prev + 1);
        }, 1000);
    }, []);

    const stopTimer = useCallback(() => {
        console.log('⏱️ Stopping call timer');
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        setCallTimer(0);
    }, []);

    const handleRejectCall = async () => {
        if (!incomingCall || !incomingCall.callSid) return;

        try {
            console.log('❌ Rejecting call:', incomingCall.callSid);

            // Call backend to reject the call
            await api.post('/api/calls/reject', { callSid: incomingCall.callSid });

            // Reset UI states
            setIncomingCall(null);
            stopNotificationSound();
        } catch (error) {
            console.error('❌ Error rejecting call:', error);
        }
    };

    const handleDial = (number) => {
        setPhoneNumber(number);
        setShowLeadsTable(false);
    };

    const toggleLeadsTable = () => {
        setShowLeadsTable(!showLeadsTable);
        if (!showLeadsTable) {
            fetchLeads();
        }
    };

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const handlePageChange = (page) => {
        if (page >= 1 && page <= totalPages) {
            setCurrentPage(page);
        }
    };

    const handleRecordsPerPageChange = (event) => {
        setRecordsPerPage(Number(event.target.value));
        setCurrentPage(1); // Reset to first page
    };

    useEffect(() => {
        if (showLeadsTable) {
            fetchLeads();
        }
    }, [showLeadsTable, currentPage, recordsPerPage]);

    const handleSelectLead = (leadId) => {
        console.log('Selecting lead with ID:', leadId); // Debugging log
        setSelectedLeads((prevSelectedLeads) => {
            if (prevSelectedLeads.includes(leadId)) {
                return prevSelectedLeads.filter((id) => id !== leadId);
            } else {
                return [...prevSelectedLeads, leadId];
            }
        });
    };

    const handleSelectAllLeads = () => {
        if (selectedLeads.length === leads.length) {
            setSelectedLeads([]);
        } else {
            setSelectedLeads(leads.map((lead) => lead._id));
        }
    };

    const handleEditLead = (lead) => {
        setEditingLead(lead);
    };

    const updateLeadDetails = async (updatedLead) => {
        try {
            await axios.put(`${API_URL}/api/leads/${updatedLead._id}`, updatedLead);
            fetchLeads(); // Refresh leads after update
            setEditingLead(null);
        } catch (error) {
            console.error('Failed to update lead:', error);
        }
    };

    const handleDeleteSelectedLeads = async () => {
        console.log('Deleting leads with IDs:', selectedLeads); // Debugging log
        try {
            await axios.delete(`${API_URL}/api/leads?leadsIds=${selectedLeads}`);
            if (selectedLeads.length > 1) {
                alert(`${selectedLeads.length} Leads deleted successfully`); // Show alert
            } else if (selectedLeads.length === 1) {
                alert(`${selectedLeads.length} Lead deleted successfully`); // Show alert
            }
            fetchLeads(); // Refresh leads after deletion
            setSelectedLeads([]);
        } catch (error) {
            console.error('Failed to delete leads:', error);
        }
    };

    return (
        <AuthProvider>
            <Router>
                <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/dashboard" element={
                        <>
                            <div className='leads'>
                                <button onClick={toggleLeadsTable}>Manage Leads</button>
                            </div>
                            {showLeadsTable && (
                                <div className={`leads-table ${showLeadsTable ? 'open' : ''}`}>
                                    <button
                                        className="upload-button"
                                        onClick={() => setShowUploadModal(true)}
                                    >
                                        Import Leads
                                    </button>
                                    {selectedLeads.length > 0 && (
                                        <div>
                                            <button className="delete-button" onClick={handleDeleteSelectedLeads}>
                                                Delete Selected
                                            </button>
                                        </div>
                                    )}
                                    <p className='total-leads'>Total Leads: {totalLeads}</p>

                                    <table>
                                        <thead>
                                            <tr>
                                                <th>
                                                    <input
                                                        type="checkbox"
                                                        className='select-leads'
                                                        checked={selectedLeads?.length === leads?.length && leads?.length > 0}
                                                        onChange={handleSelectAllLeads}
                                                    />
                                                </th>
                                                <th>Name</th>
                                                <th>Phone</th>
                                                <th>Status</th>
                                                <th>Last Contacted</th>
                                                <th>Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {leads?.map((lead) => (
                                                <tr key={lead._id}>
                                                    <td>
                                                        <input
                                                            type="checkbox"
                                                            className='select-leads'
                                                            checked={selectedLeads.includes(lead._id)}
                                                            onChange={() => handleSelectLead(lead._id)}
                                                        />
                                                    </td>
                                                    <td>{lead.name}</td>
                                                    <td>{lead.phoneNumber}</td>
                                                    <td>{lead.status}</td>
                                                    <td>{lead.lastContacted}</td>
                                                    <td className='action-buttons'>
                                                        <button className='dial-button' onClick={() => handleDial(lead.phoneNumber)}>
                                                            <FaPhoneAlt />
                                                        </button>
                                                        <button className='edit-button' onClick={() => handleEditLead(lead)}>
                                                            <FaEdit />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    <div className='pagination-controls'>
                                        <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1}>&lt;</button>
                                        {[...Array(totalPages).keys()].map((i) => (
                                            <button
                                                key={i + 1}
                                                onClick={() => handlePageChange(i + 1)}
                                                className={currentPage === i + 1 ? 'active' : ''}
                                            >
                                                {i + 1}
                                            </button>
                                        ))}
                                        <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages}>&gt;</button>
                                        <select onChange={handleRecordsPerPageChange} value={recordsPerPage}>
                                            <option value={10}>10</option>
                                            <option value={25}>25</option>
                                            <option value={50}>50</option>
                                        </select>
                                    </div>
                                </div>
                            )}
                            <div className='dialer'>
                                <div className="dialer-container">
                                    <NotificationSound play={shouldPlaySound} />
                                    <div className="dialer-header">
                                        <div className="dialer-title">Zolara<span>Talk</span></div>
                                        <div className="dialer-subtitle">Connect Seamlessly, Talk Freely</div>
                                    </div>

                                    {incomingCall && !activeCall ? (
                                        <div className="incoming-call-alert">
                                            <div className="alert-content">
                                                <h3>📞 Incoming Call</h3>
                                                <p>From: {incomingCall.from}</p>
                                                <div className="alert-actions">
                                                    <button className="call-action-button accept-action" onClick={handleAcceptCall} title="Accept Call">
                                                        <FiPhone />
                                                    </button>
                                                    <button className="call-action-button reject-action" onClick={handleRejectCall} title="Reject Call">
                                                        <FiPhoneCall />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ) : null}

                                    {activeCall && (
                                        <div className="active-call-container">
                                            <h3>📞 Active Call</h3> 
                                            <div className="call-timer">{formatTime(callTimer)}</div> 
                                        </div>
                                    )}


                                    <div className="tabs">
                                        <button className={`tab-button ${activeTab === 'dialer' ? 'active' : ''}`} onClick={() => setActiveTab('dialer')}>
                                            Dialer
                                        </button>
                                        <button className={`tab-button ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
                                            History
                                        </button>
                                    </div>

                                    {activeTab === 'dialer' ? (
                                        <>
                                            <input type="text" className="phone-input" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="Enter phone number" />

                                            <div className="dialpad">
                                                {dialpadConfig?.map(({ number, letters }) => (
                                                    <button key={number} className="dialpad-button" onClick={() => setPhoneNumber(prev => prev + number)}>
                                                        <span className="number">{number}</span>
                                                        {letters && <span className="letters">{letters}</span>}
                                                    </button>
                                                ))}
                                            </div>

                                            <div className="action-buttons">
                                                {!isCalling ? (
                                                    <button className="call-button" onClick={handleCall} disabled={!phoneNumber}>
                                                        Call
                                                    </button>
                                                ) : (
                                                    <button className="end-call-button" onClick={handleEndCall}>
                                                        End Call
                                                    </button>
                                                )}

                                                {/* {isCalling && (setIsCalling
              <div className="timer">
                {formatTime(callTimer)}
              </div>
            )} */}
                                            </div>
                                        </>
                                    ) : (
                                        <div className="call-history">
                                            {callHistory.length === 0 ? (
                                                <div className="text-center text-muted p-4">No call history</div>
                                            ) : (
                                                callHistory?.map((call) => (
                                                    <div key={call.callId} className="call-item">
                                                        <div className="call-number">{call.number}</div>
                                                        <span className={`status-badge ${call.status}`}>{call.status}</span>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                            {showUploadModal && (
                                <div className="upload-leads-modal">
                                    <div className="upload-leads-modal-content">
                                        <h2>Import Leads</h2>
                                        <p>Upload a CSV file containing lead information.</p>
                                        <input
                                            type="file"
                                            accept=".csv"
                                            onChange={(e) => setFile(e.target.files[0])}
                                        />
                                        <div className="upload-leads-modal-actions">
                                            <button
                                                className="cancel-button"
                                                onClick={() => setShowUploadModal(false)}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                className="upload-button"
                                                onClick={handleFileUpload}
                                            >
                                                Upload
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                            {editingLead && (
                                <div className="edit-lead-modal">
                                    <div className="edit-lead-modal-content">
                                        <h2>Edit Lead</h2>
                                        <form onSubmit={(e) => {
                                            e.preventDefault();
                                            updateLeadDetails(editingLead);
                                        }}>
                                            <label>
                                                Name:
                                                <input type="text" value={editingLead.name} onChange={(e) => setEditingLead({ ...editingLead, name: e.target.value })} />
                                            </label>
                                            <label>
                                                Phone Number:
                                                <input type="text" value={editingLead.phoneNumber} onChange={(e) => setEditingLead({ ...editingLead, phoneNumber: e.target.value })} />
                                            </label>
                                            <label>
                                                Status:
                                                <select value={editingLead.status} onChange={(e) => setEditingLead({ ...editingLead, status: e.target.value })}>
                                                    <option value="New">New</option>
                                                    <option value="In-Progress">In-Progress</option>
                                                    <option value="Contacted">Contacted</option>
                                                    <option value="Completed">Completed</option>
                                                    <option value="Qualified">Qualified</option>
                                                    <option value="Lost">Lost</option>
                                                    <option value="Converted">Converted</option>
                                                </select>
                                            </label>
                                            <label>
                                                Last Contacted:
                                                <input type="text" value={editingLead.lastContacted} onChange={(e) => setEditingLead({ ...editingLead, lastContacted: e.target.value })} />
                                            </label>
                                            <button type="submit" className="save-button">
                                                Save
                                            </button>
                                            <button type="button" className="cancel-button" onClick={() => setEditingLead(null)}>
                                                Cancel
                                            </button>
                                        </form>
                                    </div>
                                </div>
                            )}
                        </>
                    } />
                </Routes>
            </Router>
        </AuthProvider>
    );
}

export default App;
