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
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('✅ MongoDB Connected'))
  .catch((err) => console.error('❌ MongoDB Error:', err));

// --------------------- UTILITY FUNCTIONS ---------------------
function getLastNDates(n, includeToday = true) {
  const dates = [];
  for (let i = 0; i < n; i++) {
    dates.push(moment().tz('Asia/Kolkata').subtract(i, 'days').format('YYYY-MM-DD'));
  }
  return dates;
}

// --------------------- HOME PAGE ---------------------
app.get('/', async (req, res) => {
  try {
    const todayDate = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');

    // Fetch today's attendance
    const todayRecords = await Attendance.find({ date: todayDate }).sort({ inTime: 1 }).lean();

    // Fetch all users
    const users = await User.find({}).lean();

    // Fetch attendance for last 6 days (including today)
    const last6Dates = getLastNDates(6, true);
    const attendanceLast6 = await Attendance.find({ date: { $in: last6Dates } }).lean();

    // Merge attendance info
    const mergedRecords = users.map((user) => {
      const todayRecord = todayRecords.find((r) => r.cardUID === user.cardUID);
      const totalWorkdays = new Set(
        attendanceLast6.filter((r) => r.cardUID === user.cardUID).map((r) => r.date)
      ).size;

      return {
        name: user.name,
        cardUID: user.cardUID,
        inTime: todayRecord ? todayRecord.inTime : '-',
        outTime: todayRecord ? todayRecord.outTime || '-' : '-',
        totalWorkdays,
      };
    });

    res.render('home', { todayDate, mergedRecords });
  } catch (err) {
    console.error('❌ Error fetching home page data:', err);
    res.render('home', {
      todayDate: moment().tz('Asia/Kolkata').format('YYYY-MM-DD'),
      mergedRecords: [],
    });
  }
});

// --------------------- USER REGISTRATION ---------------------
app.post('/register', async (req, res) => {
  try {
    let { name, cardUID } = req.body;
    name = name?.trim();
    cardUID = cardUID?.trim();

    if (!name || name.length < 3)
      return res.status(400).json({ error: 'Name must be at least 3 letters.' });
    if (!cardUID || cardUID.length < 5 || cardUID.length > 16)
      return res.status(400).json({ error: 'Card UID must be between 5–16 characters.' });

    cardUID = cardUID.toUpperCase().padStart(8, '0');

    const existingUser = await User.findOne({ cardUID });
    if (existingUser)
      return res.status(400).json({ error: 'This Card UID is already registered.' });

    const user = new User({ name, cardUID });
    await user.save();

    res.json({ user, message: 'User registered successfully' });
  } catch (err) {
    console.error('❌ Error in /register:', err);
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
      // Mark IN
      record = new Attendance({ cardUID, name: user.name, date: dateStr, inTime: timeStr });
      await record.save();
      return res.json({ status: 'IN', message: 'Marked IN', record });
    } else if (!record.outTime) {
      // Mark OUT
      record.outTime = timeStr;
      await record.save();
      return res.json({ status: 'OUT', message: 'Marked OUT', record });
    } else {
      return res.status(400).json({ status: 'ALREADY_OUT', message: 'Already marked OUT today' });
    }
  } catch (err) {
    console.error('❌ Error in /attendance:', err);
    res.status(500).json({ error: err.message });
  }
});

// --------------------- ATTENDANCE VIEW ---------------------
app.get('/attendance-page', async (req, res) => {
  try {
    const selectedDate = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');
    const records = await Attendance.find({ date: selectedDate }).sort({ inTime: 1 }).lean();
    const dates = getLastNDates(6);
    res.render('attendance', { records, selectedDate, dates });
  } catch (err) {
    console.error('❌ Error loading attendance page:', err);
    res.status(500).send('Error loading attendance page');
  }
});

app.get('/attendance-page/:date', async (req, res) => {
  try {
    const selectedDate = req.params.date;
    const records = await Attendance.find({ date: selectedDate }).sort({ inTime: 1 }).lean();
    const dates = getLastNDates(6);
    res.render('attendance', { records, selectedDate, dates });
  } catch (err) {
    console.error('❌ Error loading attendance page:', err);
    res.status(500).send('Error loading attendance page');
  }
});

// --------------------- CRON JOBS ---------------------

// Auto mark OUT at 23:59 for those who forgot
cron.schedule('59 23 * * *', async () => {
  try {
    const today = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');
    const result = await Attendance.updateMany(
      { date: today, outTime: { $exists: false } },
      { $set: { outTime: '23:59:59' } }
    );
    console.log(`✅ Auto OUT updated for ${result.modifiedCount} staff at 23:59 (IST)`);
  } catch (err) {
    console.error('❌ Error in auto OUT cron:', err);
  }
});

// Optional: Recalculate summary daily at midnight
cron.schedule('5 0 * * *', async () => {
  try {
    console.log('🔄 Daily summary recalculation started...');
    const last6Dates = getLastNDates(6, true);
    const users = await User.find({}).lean();

    for (const user of users) {
      const totalWorkdays = new Set(
        (
          await Attendance.find({
            cardUID: user.cardUID,
            date: { $in: last6Dates },
          }).lean()
        ).map((r) => r.date)
      ).size;

      await User.updateOne({ cardUID: user.cardUID }, { $set: { last6DaysWork: totalWorkdays } });
    }

    console.log('✅ Daily summary updated successfully at 00:05 IST');
  } catch (err) {
    console.error('❌ Error updating daily summary:', err);
  }
});

// --------------------- START SERVER ---------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
