import axios from "axios";
import { createContext, useContext, useState, useEffect } from "react";

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    return JSON.parse(localStorage.getItem("user")) || null; // ✅ Persist session
  });

  // ✅ Sync state with localStorage
  useEffect(() => {
    localStorage.setItem("user", JSON.stringify(user));
  }, [user]);
const react_app_api_url = process.env.REACT_APP_API_URL || 'http://localhost:5000';
  const login = async (email, password) => {
    try {
      const response = await fetch(`${react_app_api_url}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      console.log("data", data);
      if (data.status === 200) {
        setUser(data.user); // Save user data
        localStorage.setItem("user", JSON.stringify(data.user));
        return { success: true };
      } else {
        return { success: false, message: data.message || "Login failed." };
      }
    } catch (error) {
      console.error("❌ API Login Error:", error);
      return { success: false, message: "Server error. Try again later." };
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("user"); // ✅ Clear stored session
    window.location.href = "/login"; // ✅ Redirect immediately
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
