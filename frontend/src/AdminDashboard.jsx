import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from './config';

function AdminDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  
  const [users, setUsers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [filterDate, setFilterDate] = useState('');
  const [filterPlan, setFilterPlan] = useState('');
  const [filterAmount, setFilterAmount] = useState('');
  const [apiKey, setApiKey] = useState(''); 

  useEffect(() => {
    if (isAuthenticated) {
      axios.get(`${API_URL}/api/admin/users`)
        .then(res => setUsers(res.data))
        .catch(err => console.error(err));
    }
  }, [isAuthenticated]);

  const handleLogin = (e) => {
    e.preventDefault();
    if (username === 'Trade' && password === 'LiveDashobard') {
      setIsAuthenticated(true);
    } else {
      alert("Invalid Credentials");
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="bg-white p-8 rounded-lg shadow-lg w-96">
          <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">Admin Login</h2>
          <form onSubmit={handleLogin}>
            <div className="mb-4">
              <label className="block text-gray-700 text-sm font-bold mb-2">Username</label>
              <input type="text" className="w-full border border-gray-300 p-2 rounded focus:outline-none focus:border-blue-500"
                value={username} onChange={e => setUsername(e.target.value)} />
            </div>
            <div className="mb-6">
              <label className="block text-gray-700 text-sm font-bold mb-2">Password</label>
              <input type="password" className="w-full border border-gray-300 p-2 rounded focus:outline-none focus:border-blue-500"
                value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            <button type="submit" className="w-full bg-blue-900 text-white font-bold py-2 px-4 rounded hover:bg-blue-800 transition">
              Login
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Derived Stats
  const totalUsers = users.length;
  const activeUsers = users.filter(u => u.paymentStatus === 'Paid').length;
  const totalRevenue = users.reduce((acc, curr) => acc + (curr.amountPaid || 0), 0);

  // Unique values for dropdowns
  const uniquePlans = [...new Set(users.map(u => u.selectedPlan?.name).filter(Boolean))];
  const uniqueAmounts = [...new Set(users.map(u => u.amountPaid).filter(Boolean))].sort((a, b) => a - b);

  // Filtered Data
  const filteredUsers = users.filter(user => {
    const matchesSearch = (user.fullName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (user.phone || '').includes(searchTerm) ||
                          (user.email || '').toLowerCase().includes(searchTerm);
    const matchesStatus = statusFilter === 'All' || user.paymentStatus === statusFilter;
    
    const userDate = user.createdAt ? new Date(user.createdAt).toISOString().split('T')[0] : '';
    const matchesDate = !filterDate || userDate === filterDate;
    const matchesPlan = !filterPlan || (user.selectedPlan?.name === filterPlan);
    const matchesAmount = !filterAmount || (user.amountPaid == filterAmount);

    return matchesSearch && matchesStatus && matchesDate && matchesPlan && matchesAmount;
  });

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      {/* Header & KPIs */}
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-800 mb-4">Live Dashboard</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white p-4 rounded shadow border-l-4 border-blue-500">
            <p className="text-gray-500 text-sm">Total Users</p>
            <p className="text-2xl font-bold">{totalUsers}</p>
          </div>
          <div className="bg-white p-4 rounded shadow border-l-4 border-green-500">
            <p className="text-gray-500 text-sm">Active Subscribers</p>
            <p className="text-2xl font-bold">{activeUsers}</p>
          </div>
          <div className="bg-white p-4 rounded shadow border-l-4 border-yellow-500">
            <p className="text-gray-500 text-sm">Total Revenue</p>
            <p className="text-2xl font-bold">₹{totalRevenue.toLocaleString()}</p>
          </div>
        </div>

        {/* Controls: API Key & Filters */}
        <div className="bg-white p-4 rounded shadow mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Admin API Key (Verification)</label>
                    <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Enter Key..." className="w-full border p-2 rounded focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Search Users</label>
                    <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Name, Email or Phone" className="w-full border p-2 rounded focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Filter Status</label>
                    <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full border p-2 rounded focus:outline-none focus:border-blue-500">
                        <option value="All">All Status</option>
                        <option value="Paid">Paid (Active)</option>
                        <option value="Expired">Expired</option>
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Filter by Date</label>
                    <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} className="w-full border p-2 rounded focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Filter by Plan</label>
                    <select value={filterPlan} onChange={e => setFilterPlan(e.target.value)} className="w-full border p-2 rounded focus:outline-none focus:border-blue-500">
                        <option value="">All Plans</option>
                        {uniquePlans.map(plan => <option key={plan} value={plan}>{plan}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Filter by Amount</label>
                    <select value={filterAmount} onChange={e => setFilterAmount(e.target.value)} className="w-full border p-2 rounded focus:outline-none focus:border-blue-500">
                        <option value="">All Amounts</option>
                        {uniqueAmounts.map(amt => <option key={amt} value={amt}>₹{amt}</option>)}
                    </select>
                </div>
            </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto bg-white shadow rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-800 text-white">
            <tr>
              <th className="py-3 px-4 text-left">Date</th>
              <th className="py-3 px-4 text-left">User Details</th>
              <th className="py-3 px-4 text-left">Plan Info</th>
              <th className="py-3 px-4 text-left">Amount</th>
              <th className="py-3 px-4 text-left">Status</th>
              <th className="py-3 px-4 text-left">Telegram</th>
            </tr>
          </thead>
          <tbody className="text-gray-700">
            {filteredUsers.map((user, index) => (
              <tr key={user._id} className="border-b hover:bg-gray-50">
                <td className="py-3 px-4">
                    {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
                    <div className="text-xs text-gray-400">{user.createdAt ? new Date(user.createdAt).toLocaleTimeString() : ''}</div>
                </td>
                <td className="py-3 px-4">
                    <div className="font-bold">{user.fullName}</div>
                    <div className="text-xs text-gray-500">{user.email}</div>
                    <div className="text-xs text-gray-500">{user.phone}</div>
                    <div className="text-xs text-gray-400">PAN: {user.panCard}</div>
                </td>
                <td className="py-3 px-4">
                    <div>{user.selectedPlan?.name}</div>
                    <div className="text-xs text-red-500">Exp: {new Date(user.subscriptionExpiryDate).toLocaleDateString()}</div>
                </td>
                <td className="py-3 px-4 font-bold">₹{user.amountPaid}</td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-1 rounded text-xs font-bold ${user.paymentStatus === 'Paid' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {user.paymentStatus}
                  </span>
                </td>
                <td className="py-3 px-4">
                    {user.telegramUserId ? 
                        <span className="text-green-600 font-bold text-xs">Joined ({user.telegramUserId})</span> : 
                        <span className="text-gray-400 text-xs">Pending</span>
                    }
                </td>
              </tr>
            ))}
            {filteredUsers.length === 0 && (
                <tr><td colSpan="6" className="text-center py-4 text-gray-500">No users found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AdminDashboard;
