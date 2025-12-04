const express = require('express');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname)); // Serve HTML, Images, etc.

const DATA_FILE = path.join(__dirname, 'data.json');

// In-memory storage for reset codes (in production, use Redis or database)
const resetCodes = new Map();

// Email transporter configuration
// Using Ethereal for testing - replace with real SMTP credentials for production
let emailTransporter = null;

async function setupEmailTransporter() {
  // Create a test account on Ethereal (for development/testing)
  // In production, replace with your actual SMTP settings
  const testAccount = await nodemailer.createTestAccount();
  
  emailTransporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });
  
  console.log('📧 Email transporter ready (using Ethereal test account)');
  console.log(`   Test emails can be viewed at: https://ethereal.email`);
  console.log(`   Login: ${testAccount.user}`);
}

// Generate a 6-digit code
function generateResetCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send reset code email
async function sendResetCodeEmail(email, code, name) {
  if (!emailTransporter) {
    await setupEmailTransporter();
  }
  
  const mailOptions = {
    from: '"Memory Box" <noreply@memorybox.app>',
    to: email,
    subject: '🔐 Your Password Reset Code - Memory Box',
    html: `
      <div style="font-family: Georgia, serif; max-width: 500px; margin: 0 auto; padding: 30px; background: #FDF8F3; border-radius: 8px;">
        <h1 style="font-family: cursive; color: #722F37; text-align: center; font-size: 2.5rem; margin-bottom: 10px;">Memory Box</h1>
        <p style="text-align: center; color: #6B5B55; font-style: italic;">~ password reset request ~</p>
        
        <div style="background: white; padding: 25px; border-radius: 4px; margin: 25px 0; border: 1px solid #D4A5A5;">
          <p style="color: #3D2C29; font-size: 1.1rem; margin-bottom: 20px;">Hello ${name || 'there'},</p>
          <p style="color: #3D2C29;">You requested to reset your password. Use the code below to continue:</p>
          
          <div style="background: linear-gradient(135deg, #722F37 0%, #5A252C 100%); color: #FDF8F3; padding: 20px; border-radius: 4px; text-align: center; margin: 25px 0;">
            <span style="font-size: 2.5rem; letter-spacing: 8px; font-weight: bold;">${code}</span>
          </div>
          
          <p style="color: #6B5B55; font-size: 0.9rem;">This code expires in <strong>2 minutes</strong>.</p>
          <p style="color: #6B5B55; font-size: 0.9rem;">If you didn't request this, you can safely ignore this email.</p>
        </div>
        
        <p style="text-align: center; font-family: cursive; color: #D4A5A5; font-size: 1.2rem;">~ with love ~</p>
      </div>
    `,
    text: `Memory Box - Password Reset\n\nHello ${name || 'there'},\n\nYour password reset code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, please ignore this email.`
  };
  
  const info = await emailTransporter.sendMail(mailOptions);
  console.log('📧 Reset code email sent:', info.messageId);
  console.log('   Preview URL:', nodemailer.getTestMessageUrl(info));
  
  return nodemailer.getTestMessageUrl(info);
}

// Initialize or load data
function getData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users: {}, photos: {} }));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ============ AUTH ROUTES ============

// Register
app.post('/api/auth/signup', (req, res) => {
  const { email, password, name, username } = req.body;
  const data = getData();
  
  // Check if email already exists
  if (data.users[email]) {
    return res.status(400).json({ error: 'Email already registered' });
  }
  
  // Validate username format
  if (!username || !/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
  }
  
  // Check if username is already taken
  const usernameLower = username.toLowerCase();
  const usernameExists = Object.values(data.users).some(
    user => user.username && user.username.toLowerCase() === usernameLower
  );
  
  if (usernameExists) {
    return res.status(400).json({ error: 'Username already taken' });
  }
  
  data.users[email] = { name, username: usernameLower, password, createdAt: Date.now() };
  data.photos[email] = []; // Initialize empty photo array
  saveData(data);
  
  res.json({ success: true, user: { email, name, username: usernameLower } });
});

// Login - accepts email or username
app.post('/api/auth/login', (req, res) => {
  const { identifier, password } = req.body;
  const data = getData();
  
  let email = null;
  let user = null;
  
  // Check if identifier is an email (direct lookup)
  if (data.users[identifier]) {
    email = identifier;
    user = data.users[identifier];
  } else {
    // Search by username
    const identifierLower = identifier.toLowerCase();
    for (const [userEmail, userData] of Object.entries(data.users)) {
      if (userData.username && userData.username.toLowerCase() === identifierLower) {
        email = userEmail;
        user = userData;
        break;
      }
    }
  }
  
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  if (user.password !== password) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  
  res.json({ success: true, user: { email, name: user.name, username: user.username } });
});

// Find account and send reset code
app.post('/api/auth/find-account', async (req, res) => {
  const { identifier } = req.body;
  const data = getData();
  
  let email = null;
  let user = null;
  
  // Check if identifier is an email (direct lookup)
  if (data.users[identifier]) {
    email = identifier;
    user = data.users[identifier];
  } else {
    // Search by username
    const identifierLower = identifier.toLowerCase();
    for (const [userEmail, userData] of Object.entries(data.users)) {
      if (userData.username && userData.username.toLowerCase() === identifierLower) {
        email = userEmail;
        user = userData;
        break;
      }
    }
  }
  
  if (!user) {
    return res.status(404).json({ error: 'No account found with that email or username' });
  }
  
  // Generate and store reset code
  const code = generateResetCode();
  const expiresAt = Date.now() + 2 * 60 * 1000; // 2 minutes
  
  resetCodes.set(email, { code, expiresAt });
  
  // Send email with code
  try {
    const previewUrl = await sendResetCodeEmail(email, code, user.name);
    
    // Mask email for privacy (show first 2 chars and domain)
    const maskedEmail = email.replace(/(.{2})(.*)(@.*)/, '$1***$3');
    
    res.json({ 
      success: true, 
      email,
      maskedEmail,
      name: user.name,
      username: user.username,
      // Include preview URL for testing (remove in production)
      emailPreviewUrl: previewUrl
    });
  } catch (err) {
    console.error('Failed to send reset email:', err);
    res.status(500).json({ error: 'Failed to send reset code email. Please try again.' });
  }
});

// Verify reset code
app.post('/api/auth/verify-code', (req, res) => {
  const { email, code } = req.body;
  
  const storedData = resetCodes.get(email);
  
  if (!storedData) {
    return res.status(400).json({ error: 'No reset code found. Please request a new one.' });
  }
  
  if (Date.now() > storedData.expiresAt) {
    resetCodes.delete(email);
    return res.status(400).json({ error: 'Reset code has expired. Please request a new one.' });
  }
  
  if (storedData.code !== code) {
    return res.status(400).json({ error: 'Invalid code. Please check and try again.' });
  }
  
  // Code is valid - mark it as verified
  storedData.verified = true;
  resetCodes.set(email, storedData);
  
  res.json({ success: true, message: 'Code verified successfully' });
});

// Resend reset code
app.post('/api/auth/resend-code', async (req, res) => {
  const { email } = req.body;
  const data = getData();
  
  const user = data.users[email];
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Generate new code
  const code = generateResetCode();
  const expiresAt = Date.now() + 2 * 60 * 1000; // 2 minutes
  
  resetCodes.set(email, { code, expiresAt });
  
  try {
    const previewUrl = await sendResetCodeEmail(email, code, user.name);
    const maskedEmail = email.replace(/(.{2})(.*)(@.*)/, '$1***$3');
    
    res.json({ 
      success: true, 
      maskedEmail,
      emailPreviewUrl: previewUrl
    });
  } catch (err) {
    console.error('Failed to resend reset email:', err);
    res.status(500).json({ error: 'Failed to send reset code email. Please try again.' });
  }
});

// Reset password (requires verified code)
app.post('/api/auth/reset-password', (req, res) => {
  const { email, code, newPassword } = req.body;
  const data = getData();
  
  if (!data.users[email]) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Verify the code again
  const storedData = resetCodes.get(email);
  
  if (!storedData || !storedData.verified) {
    return res.status(400).json({ error: 'Please verify your reset code first' });
  }
  
  if (Date.now() > storedData.expiresAt) {
    resetCodes.delete(email);
    return res.status(400).json({ error: 'Reset code has expired. Please request a new one.' });
  }
  
  if (storedData.code !== code) {
    return res.status(400).json({ error: 'Invalid reset code' });
  }
  
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  
  // Update the password
  data.users[email].password = newPassword;
  saveData(data);
  
  // Clear the reset code
  resetCodes.delete(email);
  
  res.json({ success: true, message: 'Password has been reset successfully' });
});

// ============ PHOTO ROUTES ============

// Get photos for a user
app.get('/api/photos/:userId', (req, res) => {
  const data = getData();
  const userId = decodeURIComponent(req.params.userId);
  const photos = data.photos[userId] || [];
  res.json(photos);
});

// Add a photo
app.post('/api/photos/:userId', (req, res) => {
  const data = getData();
  const userId = decodeURIComponent(req.params.userId);
  
  if (!data.photos[userId]) {
    data.photos[userId] = [];
  }
  
  const photo = {
    id: Date.now().toString(),
    imageData: req.body.imageData,
    caption: req.body.caption || '',
    angle: req.body.angle,
    radius: req.body.radius,
    group: req.body.group || null,
    createdAt: Date.now()
  };
  
  data.photos[userId].push(photo);
  saveData(data);
  res.json(photo);
});

// Update a photo (caption or group)
app.patch('/api/photos/:userId/:photoId', (req, res) => {
  console.log('PATCH photo:', { userId: req.params.userId, photoId: req.params.photoId, body: req.body });
  
  const data = getData();
  const userId = decodeURIComponent(req.params.userId);
  const photos = data.photos[userId] || [];
  const photo = photos.find(p => p.id === req.params.photoId);
  
  console.log('Found photo:', photo ? 'yes' : 'no', 'Photo IDs:', photos.map(p => p.id));
  
  if (photo) {
    if (req.body.caption !== undefined) photo.caption = req.body.caption;
    if (req.body.group !== undefined) photo.group = req.body.group;
    console.log('Updated photo group to:', photo.group);
    saveData(data);
    res.json(photo);
  } else {
    console.log('Photo not found!');
    res.status(404).json({ error: 'Photo not found' });
  }
});

// Delete a photo
app.delete('/api/photos/:userId/:photoId', (req, res) => {
  const data = getData();
  const userId = decodeURIComponent(req.params.userId);
  
  if (data.photos[userId]) {
    data.photos[userId] = data.photos[userId].filter(p => p.id !== req.params.photoId);
    saveData(data);
  }
  res.json({ success: true });
});

// Clear all photos for a user
app.delete('/api/photos/:userId', (req, res) => {
  const data = getData();
  const userId = decodeURIComponent(req.params.userId);
  data.photos[userId] = [];
  saveData(data);
  res.json({ success: true });
});

// ============ USER ROUTES ============

// Get all users (for browsing boxes)
app.get('/api/users', (req, res) => {
  const data = getData();
  const users = Object.entries(data.users).map(([email, user]) => ({
    id: email,
    name: user.name,
    username: user.username || null,
    profilePhoto: user.profilePhoto || null,
    photoCount: (data.photos[email] || []).length
  }));
  res.json(users);
});

// Get user info
app.get('/api/users/:userId', (req, res) => {
  const data = getData();
  const userId = decodeURIComponent(req.params.userId);
  const user = data.users[userId];
  
  if (user) {
    res.json({ 
      id: userId, 
      name: user.name, 
      username: user.username || null,
      profilePhoto: user.profilePhoto || null
    });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

// Update user profile (name, username, profilePhoto)
app.patch('/api/users/:userId', (req, res) => {
  const data = getData();
  const userId = decodeURIComponent(req.params.userId);
  const user = data.users[userId];
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  const { name, username, profilePhoto } = req.body;
  
  // Update name if provided
  if (name !== undefined) {
    user.name = name.trim();
  }
  
  // Update username if provided
  if (username !== undefined) {
    const usernameLower = username.toLowerCase().trim();
    
    // Validate username format
    if (usernameLower && !/^[a-zA-Z0-9_]+$/.test(usernameLower)) {
      return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
    }
    
    // Check if username is taken by another user
    const usernameExists = Object.entries(data.users).some(
      ([email, u]) => email !== userId && u.username && u.username.toLowerCase() === usernameLower
    );
    
    if (usernameExists) {
      return res.status(400).json({ error: 'Username already taken' });
    }
    
    user.username = usernameLower;
  }
  
  // Update profile photo if provided (can be null to remove)
  if (profilePhoto !== undefined) {
    user.profilePhoto = profilePhoto;
  }
  
  saveData(data);
  
  res.json({ 
    success: true, 
    user: { 
      id: userId, 
      name: user.name, 
      username: user.username,
      profilePhoto: user.profilePhoto 
    } 
  });
});

// Delete user account
app.delete('/api/users/:userId', (req, res) => {
  const data = getData();
  const userId = decodeURIComponent(req.params.userId);
  
  if (!data.users[userId]) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Delete user and their photos
  delete data.users[userId];
  delete data.photos[userId];
  
  saveData(data);
  
  res.json({ success: true });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`✨ Memory Box server running at http://localhost:${PORT}`);
  console.log(`   Open http://localhost:${PORT}/login.html to start`);
});