// models/Attendance.js
const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  cardUID: { type: String, required: true },
  name: { type: String }, // optional if you want to map UID -> name
  date: { type: String, required: true }, // YYYY-MM-DD
  inTime: { type: String },
  outTime: { type: String }
});

module.exports = mongoose.model('Attendance', attendanceSchema);
