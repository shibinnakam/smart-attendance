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

// --------------------- MIDDLEWARE ---------------------
app.use(cors());
app.use(bodyParser.json());

// Set EJS as view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Serve static files from 'public'
app.use(express.static(path.join(__dirname, "public")));

// --------------------- DATABASE ---------------------
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.error('❌ MongoDB Error:', err));

// --------------------- HOME PAGE ---------------------
app.get('/', (req, res) => {
  res.render('home'); // loads views/home.ejs
});

// --------------------- USER REGISTRATION ---------------------
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

// --------------------- MARK ATTENDANCE ---------------------
app.post('/attendance', async (req, res) => {
  try {
    const { cardUID } = req.body;
    const user = await User.findOne({ cardUID });
    if (!user) return res.status(404).json({ message: 'Card not registered' });

    const now = moment().tz("Asia/Kolkata");
    const dateStr = now.format("YYYY-MM-DD");
    const timeStr = now.format("HH:mm:ss");

    let record = await Attendance.findOne({ cardUID, date: dateStr });
    if (!record) {
      record = new Attendance({ cardUID, name: user.name, date: dateStr, inTime: timeStr });
      await record.save();
      return res.json({ message: 'Marked IN', record });
    } else {
      record.outTime = timeStr;
      await record.save();
      return res.json({ message: 'Marked OUT', record });
    }
  } catch (err) {
    console.error("Error in /attendance:", err);
    res.status(500).json({ error: err.message });
  }
});

// --------------------- API ENDPOINTS ---------------------
app.get('/attendance/today', async (req, res) => {
  const today = moment().tz("Asia/Kolkata").format("YYYY-MM-DD");
  const records = await Attendance.find({ date: today });
  res.json(records);
});

app.get('/attendance/month/:month', async (req, res) => {
  const { month } = req.params; // e.g. "2025-09"
  const records = await Attendance.find({ date: { $regex: `^${month}` } });
  res.json(records);
});

// --------------------- ATTENDANCE VIEW ---------------------

// 1️⃣ Today’s attendance page
app.get('/attendance-page', async (req, res) => {
  try {
    const selectedDate = moment().tz("Asia/Kolkata").format("YYYY-MM-DD");
    const records = await Attendance.find({ date: selectedDate });

    const dates = [];
    for (let i = 0; i < 30; i++) {
      dates.push(moment().tz("Asia/Kolkata").subtract(i, "days").format("YYYY-MM-DD"));
    }

    res.render("attendance", { records, selectedDate, dates });
  } catch (err) {
    console.error("Error loading attendance page:", err);
    res.status(500).send("Error loading attendance page");
  }
});

// 2️⃣ Specific date attendance page
app.get('/attendance-page/:date', async (req, res) => {
  try {
    const selectedDate = req.params.date;
    const records = await Attendance.find({ date: selectedDate });

    const dates = [];
    for (let i = 0; i < 30; i++) {
      dates.push(moment().tz("Asia/Kolkata").subtract(i, "days").format("YYYY-MM-DD"));
    }

    res.render("attendance", { records, selectedDate, dates });
  } catch (err) {
    console.error("Error loading attendance page:", err);
    res.status(500).send("Error loading attendance page");
  }
});

// --------------------- CRON JOB ---------------------
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

// --------------------- START SERVER ---------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
