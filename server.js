// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const cron = require('node-cron');
const moment = require('moment-timezone');
const path = require('path');

const Attendance = require('./models/Attendance');
const User = require('./models/User');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ✅ Set EJS as view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Connect MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.error('❌ MongoDB Error:', err));

/* -------------------------------
   USER REGISTRATION
--------------------------------*/
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

/* -------------------------------
   MARK ATTENDANCE
--------------------------------*/
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

    const now = moment().tz("Asia/Kolkata");
    const dateStr = now.format("YYYY-MM-DD");
    const timeStr = now.format("HH:mm:ss");

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

/* -------------------------------
   API ENDPOINTS
--------------------------------*/

// Today’s attendance (JSON API)
app.get('/attendance/today', async (req, res) => {
  const today = moment().tz("Asia/Kolkata").format("YYYY-MM-DD");
  const records = await Attendance.find({ date: today });
  res.json(records);
});

// Full month attendance (JSON API)
app.get('/attendance/month/:month', async (req, res) => {
  const { month } = req.params; // e.g. "2025-09"
  const records = await Attendance.find({ date: { $regex: `^${month}` } });
  res.json(records);
});

/* -------------------------------
   ATTENDANCE VIEW PAGE (EJS)
--------------------------------*/
app.get('/attendance-page/:date?', async (req, res) => {
  try {
    const selectedDate =
      req.params.date ||
      req.query.date ||
      moment().tz("Asia/Kolkata").format("YYYY-MM-DD");

    const records = await Attendance.find({ date: selectedDate });

    // Generate last 7 days list for sidebar
    const dates = [];
    for (let i = 0; i < 7; i++) {
      dates.push(moment().tz("Asia/Kolkata").subtract(i, "days").format("YYYY-MM-DD"));
    }

    res.render("attendance", { records, selectedDate, dates });
  } catch (err) {
    console.error("Error loading attendance page:", err);
    res.status(500).send("Error loading attendance page");
  }
});

/* -------------------------------
   CRON JOB: Auto mark OUT at 23:59
--------------------------------*/
cron.schedule('59 23 * * *', async () => {
  try {
    const today = moment().tz("Asia/Kolkata").format("YYYY-MM-DD");

    const result = await Attendance.updateMany(
      { date: today, outTime: { $exists: false } },
      { $set: { outTime: "23:59:59" } }
    );

    console.log(`✅ Auto OUT updated for ${result.modifiedCount} staff at 23:59 (IST)`);
  } catch (err) {
    console.error("❌ Error in auto OUT cron:", err);
  }
});

/* -------------------------------
   START SERVER
--------------------------------*/
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
