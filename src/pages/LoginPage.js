import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './LoginPage.css';

const LoginPage = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    rememberMe: false
  });
  const [error, setError] = useState('');
  const { login, user } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (user) {
      navigate("/"); // Redirect to home if already logged in
    }
  }, [user, navigate]);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');


    try {
      let result;

      // Login
      result = await login(formData.email, formData.password, formData.rememberMe);
      console.log(result);

      if (result.status === 200) {
        console.log("✅ Login Successful:", result);
        navigate("/");
      } else {
        console.error("❌ Login Failed:", result.message);
        setError(result.message);
      }
    } catch (error) {
      console.error("❌ Error in login function:", error);
      setError("An error occurred. Please try again.");
    }
  };



  return (
    <div className='login-page'>
      <div className="dialer-container">
        <div className="dialer-header">
          <div className="dialer-title">Zolara<span>Talk</span></div>
          <div className="dialer-subtitle">Connect Seamlessly, Talk Freely</div>
        </div>

        <div className="auth-container">


          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form">
            {!isLogin && (
              <input
                type="text"
                className="phone-input"
                placeholder="Full Name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
              />
            )}

            <label>

              <input
                type="email"
                className="phone-input"
                placeholder="Email Address"
                name="email"
                value={formData.email}
                onChange={handleChange}
                required
              />
            </label>
            <label>

              <input
                type="password"
                className="phone-input"
                placeholder="Password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                required
              />
            </label>
            {!isLogin && (
              <input
                type="password"
                className="phone-input"
                placeholder="Confirm Password"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                required
              />
            )}
            {/* {isLogin && (
            <label>
              <input type="checkbox" name="rememberMe" checked={formData.rememberMe} onChange={handleChange} /> Remember Me
            </label>
          )} */}
            <button type="submit" className="login-button">Login</button>

          </form>

        </div>
      </div>
    </div>
  );
};

export default LoginPage;
