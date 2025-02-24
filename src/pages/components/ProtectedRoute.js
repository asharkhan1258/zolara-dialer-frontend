import { Navigate } from "react-router-dom"; 
import { useAuth } from "../../context/AuthContext";

const ProtectedRoute = ({ children }) => {
  const { user } = useAuth(); // Get authentication state

  if (!user) {
    return <Navigate to="/login" replace />; // Redirect to login if not logged in
  }

  return children; // Allow access if logged in
};

export default ProtectedRoute;
