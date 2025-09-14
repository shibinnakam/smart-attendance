// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const cron = require('node-cron');   // ✅ Added for auto reset
const Attendance = require('./models/Attendance');
const User = require('./models/User');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Connect MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.error('❌ MongoDB Error:', err));

// Register a new user (assign card)
app.post('/register', async (req, res) => {
  try {
    const { name, cardUID } = req.body;
    const user = new User({ name, cardUID });
    await user.save();
    res.json({ message: 'User registered', user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Mark attendance
app.post('/attendance', async (req, res) => {
  console.log("POST body received:", req.body);
  try {
    const { cardUID } = req.body;
    console.log("Card UID from ESP32:", cardUID);

    const user = await User.findOne({ cardUID });
    if (!user) {
      console.log("Card not registered:", cardUID);
      return res.status(404).json({ message: 'Card not registered' });
    }

    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    const timeStr = today.toLocaleTimeString();

    let record = await Attendance.findOne({ cardUID, date: dateStr });

    if (!record) {
      record = new Attendance({
        cardUID,
        name: user.name,
        date: dateStr,
        inTime: timeStr
      });
      await record.save();
      console.log("Marked IN for:", cardUID);
      return res.json({ message: 'Marked IN', record });
    } else {
      record.outTime = timeStr;
      await record.save();
      console.log("Marked OUT for:", cardUID);
      return res.json({ message: 'Marked OUT', record });
    }
  } catch (err) {
    console.error("Error in /attendance:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get today’s attendance
app.get('/attendance/today', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const records = await Attendance.find({ date: today });
  res.json(records);
});

// Get full month attendance
app.get('/attendance/month/:month', async (req, res) => {
  const { month } = req.params; // "2025-09"
  const records = await Attendance.find({ date: { $regex: `^${month}` } });
  res.json(records);
});

// ✅ CRON JOB: Auto mark OUT at 23:59 if missing
cron.schedule('59 23 * * *', async () => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const result = await Attendance.updateMany(
      { date: today, outTime: { $exists: false } },
      { $set: { outTime: "23:59:59" } }
    );

    console.log(`✅ Auto OUT updated for ${result.modifiedCount} staff at 23:59`);
  } catch (err) {
    console.error("❌ Error in auto OUT cron:", err);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));