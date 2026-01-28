const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  panCard: { type: String, required: true }, // Mandatory per SEBI norms
  gstin: { type: String },
  state: { type: String, required: true },
  dob: { type: Date, required: true },
  selectedPlan: {
    name: String,
    price: Number,
    durationMinutes: Number
  },
  amountPaid: Number,
  paymentStatus: { type: String, default: 'Pending' }, // 'Pending' or 'Paid'
  subscriptionStartDate: Date,
  subscriptionExpiryDate: Date,
  telegramInviteLink: String,
  isTelegramLinkUsed: { type: Boolean, default: false },
  telegramUserId: String // Captured later via Bot to manage kicks/bans
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
