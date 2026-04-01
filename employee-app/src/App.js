import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Profile from './pages/Profile';
import MerchantForm from './pages/MerchantForm';
import MerchantDetail from './pages/MerchantDetail';

function PrivateRoute({ children }) {
  return localStorage.getItem('token') ? children : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"                  element={<Login />} />
        <Route path="/register"          element={<Register />} />
        <Route path="/dashboard"         element={<PrivateRoute><Dashboard /></PrivateRoute>} />
        <Route path="/profile"           element={<PrivateRoute><Profile /></PrivateRoute>} />
        <Route path="/merchant-form"     element={<PrivateRoute><MerchantForm /></PrivateRoute>} />
        <Route path="/merchant/:id"      element={<PrivateRoute><MerchantDetail /></PrivateRoute>} />
        <Route path="*"                  element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
