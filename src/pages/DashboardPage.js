import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import './DashboardPage.css';

const DashboardPage = () => {
  const [activeTab, setActiveTab] = useState('leads');
  const [leads, setLeads] = useState([]);
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [file, setFile] = useState(null);
  const [selectedLeads, setSelectedLeads] = useState([]);
  const [showLeadsTable, setShowLeadsTable] = useState(false);
  const { user, logout } = useAuth();

  useEffect(() => {
    fetchLeads();
    fetchCalls();
  }, []);

  const fetchLeads = async () => {
    try {
      setLoading(true);
      const { data } = await axios.get(`${process.env.REACT_APP_API_URL}/api/leads`);
      setLeads(data.leads);
    } catch (error) {
      setError('Failed to fetch leads');
    } finally {
      setLoading(false);
    }
  };

  const fetchCalls = async () => {
    try {
      const { data } = await axios.get(`${process.env.REACT_APP_API_URL}/api/calls`);
      setCalls(data.calls);
    } catch (error) {
      console.error('Failed to fetch calls:', error);
    }
  };

  const handleCall = async (phoneNumber) => {
    try {
      const response = await axios.post(`${process.env.REACT_APP_API_URL}/api/calls/initiate`, {
        to: phoneNumber,
      });
      if (response.data.success) {
        console.log('Call initiated:', response.data);
      }
    } catch (error) {
      setError('Failed to initiate call');
    }
  };

  const handleFileUpload = async () => {
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

  const handleSelectLead = (e, leadId) => {
    if (e.target.checked) {
      setSelectedLeads([...selectedLeads, leadId]);
    } else {
      setSelectedLeads(selectedLeads.filter(id => id !== leadId));
    }
  };

  const handleEditLead = (lead) => {
    // Open a modal or form to edit the lead
    console.log('Editing lead:', lead);
  };

  const handleDeleteLead = async (leadId) => {
    try {
      await axios.delete(`${process.env.REACT_APP_API_URL}/api/leads/${leadId}`);
      fetchLeads();
    } catch (error) {
      setError('Failed to delete lead');
    }
  };

  const handleDeleteSelectedLeads = async () => {
    try {
      await Promise.all(selectedLeads.map(leadId =>
        axios.delete(`${process.env.REACT_APP_API_URL}/api/leads/${leadId}`)
      ));
      setSelectedLeads([]);
      fetchLeads();
    } catch (error) {
      setError('Failed to delete selected leads');
    }
  };

  return (
    <div className="dialer-container">
      <div className="dialer-header">
        <div className="dialer-title">Zolara<span>Talk</span></div>
        <div className="dialer-subtitle">Connect Seamlessly, Talk Freely</div>
      </div>

      <div className="dashboard-header">
        <div className="user-info">
          Welcome, {user?.name}
          <button className="logout-button" onClick={logout}>
            Logout
          </button>
        </div>
        {user?.role === 'admin' && (
          <button 
            className="upload-button"
            onClick={() => setShowUploadModal(true)}
          >
            Import Leads
          </button>
        )}
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div className="tabs">
        <button 
          className={`tab-button ${activeTab === 'leads' ? 'active' : ''}`}
          onClick={() => setActiveTab('leads')}
        >
          Leads
        </button>
        <button 
          className={`tab-button ${activeTab === 'calls' ? 'active' : ''}`}
          onClick={() => setActiveTab('calls')}
        >
          Call History
        </button>
      </div>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <div className="content-container">
          {activeTab === 'leads' ? (
            <div className="leads-list">
              {leads?.map((lead) => (
                <div key={lead._id} className="lead-item">
                  <input
                    type="checkbox"
                    onChange={(e) => handleSelectLead(e, lead._id)}
                  />
                  <div className="lead-info">
                    <div className="lead-name">{lead.name}</div>
                    <div className="lead-phone">{lead.phoneNumber}</div>
                    <div className="lead-status">{lead.status}</div>
                    <div className="lead-date">
                      Last Contacted: {lead.lastContacted 
                        ? new Date(lead.lastContacted).toLocaleDateString()
                        : 'Never'}
                    </div>
                  </div>
                  <div className="lead-actions">
                    <button onClick={() => handleEditLead(lead)}>Edit</button>
                    <button onClick={() => handleDeleteLead(lead._id)}>Delete</button>
                    <button 
                      className="call-button"
                      onClick={() => handleCall(lead.phoneNumber)}
                    >
                      Call
                    </button>
                  </div>
                </div>
              ))}
              <button onClick={handleDeleteSelectedLeads} disabled={selectedLeads.length === 0}>
                Delete Selected
              </button>
            </div>
          ) : (
            <div className="calls-list">
              {calls?.map((call) => (
                <div key={call._id} className="call-item">
                  <div className="call-info">
                    <div className="call-date">
                      {new Date(call.createdAt).toLocaleString()}
                    </div>
                    <div className="call-number">
                      From: {call.from}
                      To: {call.to}
                    </div>
                    <div className="call-duration">
                      Duration: {call.duration}s
                    </div>
                    <div className={`call-status ${call.status}`}>
                      {call.status}
                    </div>
                  </div>
                  {call.recordingUrl && (
                    <div className="call-actions">
                      <button 
                        className="play-button"
                        onClick={() => window.open(call.recordingUrl)}
                      >
                        Play Recording
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showUploadModal && (
        <div className="modal">
          <div className="modal-content">
            <h2>Import Leads</h2>
            <p>Upload a CSV file containing lead information.</p>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setFile(e.target.files[0])}
            />
            <div className="modal-actions">
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
    </div>
  );
};

export default DashboardPage;
