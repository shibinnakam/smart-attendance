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
app.use(bodyParser.urlencoded({ extended: true }));

// Set EJS as view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// --------------------- DATABASE ---------------------
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.error('❌ MongoDB Error:', err));

// --------------------- STAFF SUMMARY FUNCTION ---------------------
async function getStaffSummary() {
  const dates = [];
  for (let i = 1; i <= 6; i++) {
    dates.push(moment().tz('Asia/Kolkata').subtract(i, 'days').format('YYYY-MM-DD'));
  }

  const allUsers = await User.find({}).lean();
  const attendanceRecords = await Attendance.find({ date: { $in: dates } }).lean();

  const summary = allUsers.map(user => {
    const presentDays = new Set(
      attendanceRecords.filter(rec => rec.cardUID === user.cardUID).map(r => r.date)
    ).size;

    return {
      name: user.name,
      cardUID: user.cardUID,
      presentDays,
      totalDays: 6
    };
  });

  return summary;
}

// --------------------- HOME PAGE ---------------------
app.get('/', async (req, res) => {
  try {
    const todayDate = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');
    const records = await Attendance.find({ date: todayDate }).sort({ inTime: 1 }).lean();
    const staffSummary = await getStaffSummary();

    res.render('home', { todayDate, records, staffSummary });
  } catch (err) {
    console.error('Error fetching data for home page:', err);
    res.render('home', { todayDate: moment().tz('Asia/Kolkata').format('YYYY-MM-DD'), records: [], staffSummary: [] });
  }
});

// --------------------- USER REGISTRATION ---------------------
app.post('/register', async (req, res) => {
  try {
    let { name, cardUID } = req.body;
    name = name?.trim();
    cardUID = cardUID?.trim();

    if (!name || name.length < 3) return res.status(400).json({ error: 'Name must be at least 3 letters.' });
    if (!cardUID || cardUID.length < 5 || cardUID.length > 16) return res.status(400).json({ error: 'Card UID must be between 5–16 characters.' });

    cardUID = cardUID.toUpperCase().padStart(8, '0');

    const existingUser = await User.findOne({ cardUID });
    if (existingUser) return res.status(400).json({ error: 'This Card UID is already registered.' });

    const user = new User({ name, cardUID });
    await user.save();

    res.json({ user, message: 'User registered successfully' });
  } catch (err) {
    console.error('Error in /register:', err);
    res.status(500).json({ error: 'Server error. Could not register user.' });
  }
});

// --------------------- MARK ATTENDANCE ---------------------
app.post('/attendance', async (req, res) => {
  try {
    let { cardUID } = req.body;
    cardUID = cardUID.toUpperCase().padStart(8, '0');

    const user = await User.findOne({ cardUID });
    if (!user) return res.status(404).json({ message: 'Card not registered' });

    const now = moment().tz('Asia/Kolkata');
    const dateStr = now.format('YYYY-MM-DD');
    const timeStr = now.format('HH:mm:ss');

    let record = await Attendance.findOne({ cardUID, date: dateStr });

    if (!record) {
      record = new Attendance({ cardUID, name: user.name, date: dateStr, inTime: timeStr });
      await record.save();
      return res.json({ status: 'IN', message: 'Marked IN', record });
    } else if (!record.outTime) {
      record.outTime = timeStr;
      await record.save();
      return res.json({ status: 'OUT', message: 'Marked OUT', record });
    } else {
      return res.status(400).json({ status: 'ALREADY_OUT', message: 'Already marked OUT today' });
    }
  } catch (err) {
    console.error('Error in /attendance:', err);
    res.status(500).json({ error: err.message });
  }
});

// --------------------- ATTENDANCE VIEW ---------------------
function getLast7Days() {
  const days = [];
  for (let i = 0; i < 7; i++) {
    days.push(moment().tz('Asia/Kolkata').subtract(i, 'days').format('YYYY-MM-DD'));
  }
  return days;
}

app.get('/attendance-page', async (req, res) => {
  try {
    const selectedDate = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');
    const records = await Attendance.find({ date: selectedDate }).sort({ inTime: 1 }).lean();
    const dates = getLast7Days();
    res.render('attendance', { records, selectedDate, dates });
  } catch (err) {
    console.error('Error loading attendance page:', err);
    res.status(500).send('Error loading attendance page');
  }
});

app.get('/attendance-page/:date', async (req, res) => {
  try {
    const selectedDate = req.params.date;
    const records = await Attendance.find({ date: selectedDate }).sort({ inTime: 1 }).lean();
    const dates = getLast7Days();
    res.render('attendance', { records, selectedDate, dates });
  } catch (err) {
    console.error('Error loading attendance page:', err);
    res.status(500).send('Error loading attendance page');
  }
});

// --------------------- CRON JOB ---------------------
cron.schedule('59 23 * * *', async () => {
  try {
    const today = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');
    const result = await Attendance.updateMany({ date: today, outTime: { $exists: false } }, { $set: { outTime: '23:59:59' } });
    console.log(`✅ Auto OUT updated for ${result.modifiedCount} staff at 23:59 (IST)`);
  } catch (err) {
    console.error('❌ Error in auto OUT cron:', err);
  }
});

// --------------------- START SERVER ---------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
