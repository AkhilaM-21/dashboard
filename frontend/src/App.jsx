import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';
import AdminDashboard from './AdminDashboard';
import { API_URL } from './config';
import { validatePan, formatPan, PAN_LENGTH, validatePhone, formatPhone, PHONE_LENGTH } from './validators';

const plans = [
  { id: 1, name: 'LIVE TRADING - 5 MIN', price: 2499, originalPrice: 2500, duration: 5 },
  { id: 2, name: 'LIVE TRADING - 10 MIN', price: 6998, originalPrice: 7500, discount: '6.7%', duration: 10 },
  { id: 3, name: 'LIVE TRADING - 20 MIN', price: 13949, originalPrice: 14994, discount: '7%', duration: 20 },
  { id: 4, name: 'LIVE TRADING - 30 MIN', price: 27989, originalPrice: 29988, discount: '6.7%', duration: 30 },
];

const EMPTY_FORM = {
  state: '', gstin: '', pan: '', dob: '', email: '', phone: '', fullName: '', agree: false
};

function App() {
  const [step, setStep] = useState(1); // 1: Landing/Plans, 2: Form, 3: Success, 4: Admin
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [telegramLink, setTelegramLink] = useState('');
  const [registrationId, setRegistrationId] = useState('');
  const [joinStatus, setJoinStatus] = useState(null); // { joined, expiresAt, planName }
  const [panError, setPanError] = useState('');
  const [formError, setFormError] = useState('');

  // Phone verification (OTP) — must pass before registration is allowed
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpError, setOtpError] = useState('');
  const [otpNotice, setOtpNotice] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);

  // Form State
  const [formData, setFormData] = useState(EMPTY_FORM);

  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setPanError('');
    setFormError('');
    setOtpSent(false);
    setOtpCode('');
    setOtpError('');
    setOtpNotice('');
    setPhoneVerified(false);
  };

  // Editing the number invalidates any verification already done for it
  const handlePhoneChange = (e) => {
    setFormData({ ...formData, phone: formatPhone(e.target.value) });
    setPhoneVerified(false);
    setOtpSent(false);
    setOtpCode('');
    setOtpError('');
    setOtpNotice('');
  };

  // While the success page is open, watch for the invite to be used so a spent
  // link is never left on screen.
  useEffect(() => {
    if (step !== 3 || !registrationId || joinStatus?.joined) return;

    let cancelled = false;
    const check = async () => {
      try {
        const { data } = await axios.get(`${API_URL}/api/registration/${registrationId}`);
        if (!cancelled) setJoinStatus(data);
      } catch {
        // transient network blip — keep polling
      }
    };

    check();
    const timer = setInterval(check, 4000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [step, registrationId, joinStatus?.joined]);

  const sendOtp = async () => {
    const check = validatePhone(formData.phone);
    if (!check.valid) return setOtpError(check.error);

    setOtpBusy(true);
    setOtpError('');
    try {
      const { data } = await axios.post(`${API_URL}/api/send-otp`, { phone: check.phone });
      setOtpSent(true);
      // Without Twilio the server returns the code so the flow stays testable
      setOtpNotice(data.devCode ? `SMS is not configured — your code is ${data.devCode}` : 'Code sent by SMS.');
    } catch (error) {
      setOtpError(error.response?.data?.error || 'Could not send the code. Is the backend running?');
    }
    setOtpBusy(false);
  };

  const verifyOtp = async () => {
    setOtpBusy(true);
    setOtpError('');
    try {
      await axios.post(`${API_URL}/api/verify-otp`, { phone: formData.phone, code: otpCode });
      setPhoneVerified(true);
      setOtpNotice('');
    } catch (error) {
      setOtpError(error.response?.data?.error || 'Could not verify the code.');
    }
    setOtpBusy(false);
  };

  // Live PAN feedback: normalize as they type, but only complain once the
  // field is full so we're not shouting at a half-typed number.
  const handlePanChange = (e) => {
    const pan = formatPan(e.target.value);
    setFormData({ ...formData, pan });
    setPanError(pan.length === PAN_LENGTH ? (validatePan(pan).error || '') : '');
  };

  const handlePanBlur = () => {
    if (formData.pan) setPanError(validatePan(formData.pan).error || '');
  };

  const panCheck = validatePan(formData.pan);

  const handlePlanSelect = (plan) => {
    setSelectedPlan(plan);
    setStep(2);
    window.scrollTo(0, 0);
  };

  const calculateTotal = () => {
    if (!selectedPlan) return { subTotal: 0, gst: 0, total: 0 };
    
    // Logic based on user prompt: 
    // Plan: 27989 -> GST: 5038.02 -> Total: 33027.02
    // This implies GST is calculated as 18% ON TOP of the plan price.
    const subTotal = selectedPlan.price;
    const gst = subTotal * 0.18;
    const total = subTotal + gst;

    return {
      subTotal: subTotal.toFixed(2),
      gst: gst.toFixed(2),
      total: total.toFixed(2)
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    const pan = validatePan(formData.pan);
    if (!pan.valid) {
      setPanError(pan.error);
      return;
    }
    if (!phoneVerified) {
      setFormError('Please verify your phone number first.');
      return;
    }
    if (!formData.agree) {
      setFormError('Please agree to the terms before continuing.');
      return;
    }

    const totals = calculateTotal();
    setLoading(true);

    try {
      // Bypass Payment: Directly register user
      const payload = {
        ...formData,
        panCard: formatPan(formData.pan), // Mapping 'pan' from state to 'panCard' for backend
        plan: {
          name: selectedPlan.name,
          price: selectedPlan.price,
          durationMinutes: selectedPlan.duration,
          totalAmount: parseFloat(totals.total)
        }
      };

      const response = await axios.post(`${API_URL}/api/register`, payload);
      
      console.log("Server Response:", response.data);
      setTelegramLink(response.data.link);
      setRegistrationId(response.data.registrationId);
      setJoinStatus(null);
      setLoading(false);
      // Clear it now so reopening the form starts blank instead of carrying
      // this registration's details into the next one.
      resetForm();
      setStep(3);
    } catch (error) {
      setLoading(false);
      const serverError = error.response?.data?.error;
      if (error.response?.data?.field === 'panCard') {
        setPanError(serverError);
      } else {
        setFormError(serverError || 'Registration failed. Please ensure the backend is running.');
      }
      console.error(error);
    }
  };

  // --- RENDER HELPERS ---

  const renderHeader = () => (
    <header className="bg-blue-900 text-white p-4 text-center shadow-md">
      <h1 className="text-xl font-bold tracking-wider">TRADOTSAV - SEBI RA</h1>
      <p className="text-sm opacity-90">Created by telugutradershyamsebira</p>
      <p className="text-xs opacity-75 mt-1">Registered with SEBI (INH000018869)</p>
    </header>
  );

  const renderLanding = () => (
    <div className="container mx-auto p-4 max-w-4xl">
      <div className="text-center mb-8 mt-4">
        <span className="bg-blue-100 text-blue-800 text-xs font-semibold px-2.5 py-0.5 rounded dark:bg-blue-200 dark:text-blue-800">Finance</span>
        <h2 className="text-3xl font-bold text-gray-800 mt-2">Level Up Your Trading. Level Up Your Life.</h2>
        <p className="mt-2 text-gray-600">Unlock powerful insights, smarter decisions, and proven strategies… all in ONE community.</p>
        
        <div className="mt-6 bg-yellow-50 p-4 rounded-lg border border-yellow-200 inline-block shadow-sm">
          <p className="font-bold text-yellow-800">⚡️ Get Daily 3-8 Bank Nifty, Nifty50 & Sensex</p>
          <p className="font-bold text-blue-900">OPTIONS BUYING TRADES</p>
        </div>
      </div>

      {/* Features Grid */}
      <div className="grid md:grid-cols-3 gap-4 text-center mb-8">
        <div className="p-4 bg-white shadow rounded">
          <h4 className="font-bold text-green-600">PERFECT RRR</h4>
        </div>
        <div className="p-4 bg-white shadow rounded">
          <h4 className="font-bold text-green-600">SMALLEST SL</h4>
        </div>
        <div className="p-4 bg-white shadow rounded">
          <h4 className="font-bold text-green-600">RISK MANAGEMENT</h4>
        </div>
      </div>

      {/* Disclaimer Box */}
      <div className="bg-gray-50 p-4 text-xs text-gray-500 h-40 overflow-y-scroll mb-8 border rounded">
        <p className="font-bold mb-2">Standard Disclosure</p>
        <p>SEBI Registered Research Analyst Registration No. INH000018869</p>
        <p className="mt-2">The particulars given in this Disclosure Document have been prepared in accordance with SEBI (Research Analyst) Regulations, 2014...</p>
        <p className="mt-2"><strong>Refund Policy:</strong> We highly value our clients... however, we do not provide a 100% guarantee on our calls. Therefore, all sales are final and we do not accept any refunds or cancellations.</p>
        <p className="mt-2">"Investments in securities market are subject to market risks. Read all the related documents carefully before investing."</p>
      </div>

      <h3 className="text-xl font-bold mb-6 text-center border-b pb-2">Select a plan and continue</h3>
      <div className="grid md:grid-cols-2 gap-6">
        {plans.map(plan => (
          <div key={plan.id} onClick={() => handlePlanSelect(plan)} 
               className="plan-card border-2 border-gray-200 hover:border-blue-500 rounded-xl p-6 cursor-pointer bg-white transition shadow-lg relative">
            {plan.discount && <span className="absolute top-0 right-0 bg-green-500 text-white text-xs font-bold px-3 py-1 rounded-bl-xl rounded-tr-xl">{plan.discount} OFF</span>}
            <h4 className="font-bold text-lg text-gray-700">{plan.name}</h4>
            <div className="mt-3 flex items-baseline">
              <span className="text-gray-400 line-through text-sm mr-2">₹{plan.originalPrice}</span>
              <span className="text-3xl font-bold text-blue-900">₹{plan.price}</span>
            </div>
          </div>
        ))}
      </div>
      
      <div className="mt-12 text-center border-t pt-4">
        <button onClick={() => setStep(4)} className="text-gray-400 hover:text-blue-500 text-xs underline">Admin Dashboard Login</button>
      </div>
    </div>
  );

  const renderForm = () => {
    const { subTotal, gst, total } = calculateTotal();
    return (
      <div className="container mx-auto p-4 max-w-lg">
        <button onClick={() => setStep(1)} className="text-blue-600 font-semibold mb-6 flex items-center hover:underline">
          &larr; Change Plan
        </button>
        
        <div className="bg-blue-50 p-5 rounded-lg mb-6 border border-blue-100">
          <p className="text-sm text-gray-500 uppercase font-bold">Selected Plan</p>
          <h3 className="font-bold text-lg text-blue-900">{selectedPlan.name}</h3>
          <p className="text-2xl font-bold text-blue-900 mt-1">₹{selectedPlan.price}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 bg-white p-6 rounded-lg shadow-md border">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Your full name</label>
            <input type="text" required value={formData.fullName} className="w-full border border-gray-300 p-2 rounded focus:outline-none focus:border-blue-500"
              onChange={e => setFormData({...formData, fullName: e.target.value})} />
          </div>
          
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Registered email id</label>
            <input type="email" required value={formData.email} className="w-full border border-gray-300 p-2 rounded focus:outline-none focus:border-blue-500"
              onChange={e => setFormData({...formData, email: e.target.value})} />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Phone Number (must be verified)</label>
            <div className="flex gap-2">
              <input
                type="tel"
                required
                value={formData.phone}
                maxLength={PHONE_LENGTH}
                placeholder="10-digit mobile"
                disabled={phoneVerified}
                className={`flex-1 border p-2 rounded focus:outline-none ${
                  phoneVerified ? 'border-green-400 bg-green-50 text-gray-600' : 'border-gray-300 focus:border-blue-500'
                }`}
                onChange={handlePhoneChange}
              />
              {!phoneVerified && (
                <button type="button" onClick={sendOtp} disabled={otpBusy}
                  className="px-3 py-2 text-sm font-bold rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400 whitespace-nowrap">
                  {otpBusy ? '...' : otpSent ? 'Resend' : 'Send OTP'}
                </button>
              )}
            </div>

            {phoneVerified && <p className="text-xs text-green-600 mt-1">✓ Phone verified</p>}

            {otpSent && !phoneVerified && (
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otpCode}
                  placeholder="Enter 6-digit code"
                  className="flex-1 border border-gray-300 p-2 rounded tracking-widest font-mono focus:outline-none focus:border-blue-500"
                  onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))}
                />
                <button type="button" onClick={verifyOtp} disabled={otpBusy || otpCode.length !== 6}
                  className="px-3 py-2 text-sm font-bold rounded bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-400">
                  Verify
                </button>
              </div>
            )}

            {otpError && <p className="text-xs text-red-600 mt-1">{otpError}</p>}
            {otpNotice && !otpError && <p className="text-xs text-blue-600 mt-1">{otpNotice}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="pan" className="block text-xs font-bold text-gray-700 mb-1">PAN CARD (Mandatory)</label>
              <input
                id="pan"
                type="text"
                required
                value={formData.pan}
                maxLength={PAN_LENGTH}
                placeholder="ABCPE1234F"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!!panError}
                aria-describedby="pan-help"
                className={`w-full border p-2 rounded tracking-widest font-mono focus:outline-none ${
                  panError
                    ? 'border-red-400 focus:border-red-500 bg-red-50'
                    : panCheck.valid
                      ? 'border-green-400 focus:border-green-500'
                      : 'border-gray-300 focus:border-blue-500'
                }`}
                onChange={handlePanChange}
                onBlur={handlePanBlur}
              />
              <p id="pan-help" className="text-xs mt-1 leading-tight">
                {panError
                  ? <span className="text-red-600">{panError}</span>
                  : panCheck.valid
                    ? <span className="text-green-600">✓ Valid — {panCheck.entity}</span>
                    : <span className="text-gray-400">{formData.pan.length}/{PAN_LENGTH} · 5 letters, 4 digits, 1 letter</span>}
              </p>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Date of Birth</label>
              <input type="date" required value={formData.dob} className="w-full border border-gray-300 p-2 rounded focus:outline-none focus:border-blue-500"
                onChange={e => setFormData({...formData, dob: e.target.value})} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Select State</label>
              <select required value={formData.state} className="w-full border border-gray-300 p-2 rounded focus:outline-none focus:border-blue-500" onChange={e => setFormData({...formData, state: e.target.value})}>
                <option value="">Select...</option>
                <option value="AP">Andhra Pradesh</option>
                <option value="TS">Telangana</option>
                <option value="MH">Maharashtra</option>
                <option value="KA">Karnataka</option>
                <option value="TN">Tamil Nadu</option>
                <option value="DL">Delhi</option>
                {/* Add other states as needed */}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">GSTIN (Optional)</label>
              <input type="text" value={formData.gstin} className="w-full border border-gray-300 p-2 rounded uppercase focus:outline-none focus:border-blue-500"
                onChange={e => setFormData({...formData, gstin: e.target.value})} />
            </div>
          </div>

          <div className="border-t border-dashed border-gray-300 pt-4 mt-4">
            <div className="flex justify-between text-sm"><span>Sub Total</span><span>₹{subTotal}</span></div>
            <div className="flex justify-between text-sm text-gray-600 mt-1"><span>GST (18%)</span><span>₹{gst}</span></div>
            <div className="flex justify-between font-bold text-xl mt-3 text-blue-900"><span>Total</span><span>₹{total}</span></div>
          </div>

          <div className="flex items-start gap-2 mt-4 bg-gray-50 p-2 rounded">
            <input type="checkbox" required id="agree" checked={formData.agree} className="mt-1" onChange={e => setFormData({...formData, agree: e.target.checked})} />
            <label htmlFor="agree" className="text-xs text-gray-600 leading-tight">
              I agree to telugutradershyamsebira's Terms. I understand there are no refunds and the Telegram link is valid for one-time use only.
            </label>
          </div>

          {formError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{formError}</p>
          )}

          <button type="submit" disabled={loading || !panCheck.valid || !phoneVerified} className="w-full bg-blue-600 text-white p-3 rounded font-bold hover:bg-blue-700 transition shadow-lg disabled:bg-gray-400 disabled:cursor-not-allowed">
            {loading ? 'Processing...' : !phoneVerified ? 'Verify your phone to continue' : `Complete Registration (Bypass Payment)`}
          </button>
        </form>
      </div>
    );
  };

  const renderSuccess = () => {
    const joined = Boolean(joinStatus?.joined);
    const expiresAt = joinStatus?.expiresAt ? new Date(joinStatus.expiresAt) : null;
    const expiryText = expiresAt?.toLocaleString('en-IN', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });

    return (
      <div className="container mx-auto p-8 text-center max-w-md mt-10">
        <div className="bg-green-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
          <span className="text-green-600 text-5xl">✓</span>
        </div>

        {joined ? (
          <>
            <h2 className="text-2xl font-bold text-gray-800">You're in!</h2>
            <p className="mt-4 text-gray-600">You've joined the Tradotsav channel.</p>

            <div className="mt-6 bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-800 font-semibold">Subscription active</p>
              {joinStatus?.planName && <p className="text-xs text-green-700 mt-1">{joinStatus.planName}</p>}
              {expiryText && <p className="text-xs text-green-700 mt-1">Valid until {expiryText}</p>}
            </div>

            <p className="text-xs text-gray-400 mt-4">
              Your invite link has been used and no longer works. You'll get a reminder before your plan expires.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-bold text-gray-800">Payment Successful!</h2>
            <p className="mt-4 text-gray-600">Thank you for joining Tradotsav.</p>
            <p className="mt-2 text-sm text-gray-500">Your phone is verified — you can join the channel now.</p>

            <a
              href={telegramLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 block w-full bg-blue-600 text-white p-4 rounded-lg font-bold text-lg hover:bg-blue-700 transition shadow-lg"
            >
              Join Telegram Channel
            </a>

            <p className="text-xs text-red-500 mt-4">
              ⚠️ Do not share this link. It works only once and stops working after you join.
            </p>
          </>
        )}

        <button onClick={() => setStep(1)} className="mt-8 bg-gray-800 text-white px-6 py-2 rounded hover:bg-gray-900 transition">
          Return Home
        </button>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-gray-800">
      {renderHeader()}
      {step === 1 && renderLanding()}
      {step === 2 && renderForm()}
      {step === 3 && renderSuccess()}
      {step === 4 && <AdminDashboard />}
      
      <footer className="text-center text-xs text-gray-400 p-8">
        <p>Disclaimer: Cosmofeed Technologies Pvt. Ltd. shall not be held liable...</p>
      </footer>
    </div>
  );
}

export default App;
