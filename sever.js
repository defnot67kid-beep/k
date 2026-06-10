const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Secret keys - Use environment variables in production!
const JWT_SECRET = process.env.JWT_SECRET || "TAVIAN_SUPER_SECRET_KEY_CHANGE_THIS_12345";
const HCAPTCHA_SECRET = process.env.HCAPTCHA_SECRET || "ES_3e9f86c0fff2435a9c741ef2d05a438f";

// Frontend URL (Netlify)
const FRONTEND_URL = process.env.FRONTEND_URL || "https://tavian.netlify.app";

// Data file path
const DATA_FILE = path.join(__dirname, 'data.json');
const GAMES_FILE = path.join(__dirname, 'games.json');

// Initialize data file
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users: [], nextId: 1, chatLogs: [] }, null, 2));
}

// Initialize games file
if (!fs.existsSync(GAMES_FILE)) {
    fs.writeFileSync(GAMES_FILE, JSON.stringify({ games: [], nextId: 100000000 }, null, 2));
}

// ============= GAME HELPER FUNCTIONS =============
function readGames() {
    const data = fs.readFileSync(GAMES_FILE);
    return JSON.parse(data);
}

function writeGames(data) {
    fs.writeFileSync(GAMES_FILE, JSON.stringify(data, null, 2));
}

function generateGameId() {
    const games = readGames();
    let newId = games.nextId || 100000000;
    games.nextId = newId + 1;
    writeGames(games);
    return newId.toString();
}

// ============= ADVANCED MODERATION SYSTEM =============

// Comprehensive banned words with context awareness
const bannedWords = new Map([
    ['fuck', { severity: 10, contexts: ['sexual', 'insult', 'violent'] }],
    ['shit', { severity: 7, contexts: ['excretory', 'insult'] }],
    ['damn', { severity: 3, contexts: ['mild'] }],
    ['ass', { severity: 5, contexts: ['insult', 'bodypart'] }],
    ['bitch', { severity: 8, contexts: ['insult', 'misogynistic'] }],
    ['cunt', { severity: 10, contexts: ['extreme', 'insult'] }],
    ['dick', { severity: 7, contexts: ['sexual', 'insult'] }],
    ['pussy', { severity: 8, contexts: ['sexual', 'insult'] }],
    ['cock', { severity: 8, contexts: ['sexual'] }],
    ['whore', { severity: 9, contexts: ['sexual', 'insult'] }],
    ['bastard', { severity: 6, contexts: ['insult'] }],
    ['slut', { severity: 9, contexts: ['sexual', 'insult'] }],
    ['nigger', { severity: 10, contexts: ['racist', 'extreme'] }],
    ['nigga', { severity: 8, contexts: ['racist', 'cultural'] }],
    ['faggot', { severity: 10, contexts: ['homophobic', 'extreme'] }],
    ['retard', { severity: 8, contexts: ['ableist', 'insult'] }],
    ['kys', { severity: 10, contexts: ['violent', 'selfharm'] }],
    ['kill yourself', { severity: 10, contexts: ['violent', 'selfharm'] }],
    ['cum', { severity: 8, contexts: ['sexual'] }],
    ['dildo', { severity: 7, contexts: ['sexual'] }],
    ['porn', { severity: 6, contexts: ['sexual'] }],
    ['nude', { severity: 5, contexts: ['sexual'] }],
    ['anal', { severity: 7, contexts: ['sexual'] }],
    ['ballsack', { severity: 6, contexts: ['sexual', 'bodypart'] }],
    ['rape', { severity: 10, contexts: ['violent', 'sexual'] }],
    ['rapist', { severity: 10, contexts: ['violent', 'sexual'] }],
    ['motherfucker', { severity: 9, contexts: ['insult', 'extreme'] }],
    ['fucker', { severity: 8, contexts: ['insult'] }],
    ['twat', { severity: 7, contexts: ['insult', 'bodypart'] }],
    ['clit', { severity: 7, contexts: ['sexual', 'bodypart'] }],
    ['boner', { severity: 6, contexts: ['sexual'] }],
    ['prick', { severity: 5, contexts: ['insult'] }],
    ['wanker', { severity: 6, contexts: ['insult'] }],
    ['bollocks', { severity: 5, contexts: ['mild'] }],
    ['arsehole', { severity: 7, contexts: ['insult'] }],
    ['asshole', { severity: 6, contexts: ['insult'] }],
    ['shithead', { severity: 7, contexts: ['insult'] }],
    ['dumbass', { severity: 5, contexts: ['insult'] }],
    ['hitler', { severity: 10, contexts: ['hate', 'historical'] }],
    ['nazi', { severity: 10, contexts: ['hate', 'historical'] }],
    ['holocaust', { severity: 9, contexts: ['sensitive'] }],
    ['white power', { severity: 10, contexts: ['racist', 'hate'] }],
    ['black power', { severity: 4, contexts: ['political'] }],
]);

const allowlist = new Set([
    'assassin', 'assassinate', 'assassination', 'assault', 'assemble', 'assembly', 
    'assist', 'assistant', 'associate', 'association', 'assume', 'assumption', 
    'assure', 'assurance', 'asset', 'assets', 'assign', 'assignment', 'assistive',
    'assert', 'assertion', 'assess', 'assessment', 'assimilate', 'assimilation',
    'cocktail', 'cockatoo', 'cockpit', 'cocksure', 'cocky', 'cockney', 'cockerel',
    'cockroach', 'cockscomb', 'cockleshell', 'cockfight', 'cockspur',
    'ship', 'shipping', 'shipment', 'shirt', 'shift', 'shifting', 'shifty',
    'bitcoin', 'bicycle', 'biscuit', 'bistro', 'bilingual', 'binary', 'binding',
    'damage', 'damaging', 'damascus', 'damask', 'damnation', 'damocles',
    'night', 'nightmare', 'nightly', 'nightfall', 'nightclub', 'nightingale',
    'nigeria', 'nigerian', 'niger', 'nigerien', 'nighthawk', 'nightshade',
    'grape', 'drapery', 'scrape', 'scraper', 'scraping', 'scrapped', 'crape',
    'skill', 'skilling', 'killingly', 'killdeer', 'killjoy', 'killifish',
    'sussex', 'essex', 'wessex', 'middlesex', 'sexes', 'sexism', 'sexist',
]);

const safePhrases = new Set([
    'i love this game', 'good game', 'nice shot', 'well played',
    'how are you', 'im fine', 'thank you', 'thanks', 'please',
    'sorry', 'my bad', 'good luck', 'have fun', 'enjoying',
    'beautiful', 'amazing', 'awesome', 'fantastic', 'wonderful'
]);

const dangerousPatterns = [
    { regex: /\b(kill\s+yourself|kys|self\s+harm|suicide)\b/i, severity: 10, type: 'selfharm' },
    { regex: /\b(rape|rapist|molest|pedophile)\b/i, severity: 10, type: 'sexual_violence' },
    { regex: /\b(bomb|terrorist|jihad|shoot\s+up)\b/i, severity: 10, type: 'terrorism' },
    { regex: /\b(white\s+supremacy|kkk|klansman|aryan)\b/i, severity: 10, type: 'hatespeech' },
    { regex: /\b(transphobic|homophobic|misogynistic)\b/i, severity: 9, type: 'hate' },
];

const leetMap = {
    '0': 'o', '1': 'i', '2': 'z', '3': 'e', '4': 'a', '5': 's', '6': 'g', '7': 't', '8': 'b', '9': 'g',
    '@': 'a', '!': 'i', '$': 's', '%': 'e', '^': 'n', '&': 'a', '*': 'o', '(': 'c', ')': 'c',
};

function normalizeLeet(text) {
    let normalized = text.toLowerCase();
    for (const [leet, normal] of Object.entries(leetMap)) {
        normalized = normalized.split(leet).join(normal);
    }
    normalized = normalized.replace(/(.)\1{2,}/g, '$1$1');
    return normalized;
}

function isAllowlisted(word) {
    const normalized = word.toLowerCase();
    if (allowlist.has(normalized)) return true;
    for (const allowed of allowlist) {
        if (normalized.includes(allowed) && allowed.length > 3) {
            const remaining = normalized.replace(allowed, '');
            if (remaining.length === 0 || /^[aeiou\s]+$/i.test(remaining)) {
                return true;
            }
        }
    }
    return false;
}

function isSafePhrase(message) {
    const lowerMsg = message.toLowerCase();
    for (const phrase of safePhrases) {
        if (lowerMsg.includes(phrase)) return true;
    }
    return false;
}

function checkContext(message, badWord, wordContext) {
    const lowerMsg = message.toLowerCase();
    const words = lowerMsg.split(/\s+/);
    
    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        if (word.length > badWord.length + 2 && word.includes(badWord)) {
            if (allowlist.has(word) || isAllowlisted(word)) {
                return { allowed: true, reason: 'part_of_allowlist_word' };
            }
        }
    }
    
    const positiveIndicators = ['not', 'no', 'never', 'isn\'t', 'aren\'t', 'wasn\'t', 'weren\'t'];
    for (const indicator of positiveIndicators) {
        const pattern = new RegExp(`\\b${indicator}\\s+${badWord}\\b`, 'i');
        if (pattern.test(lowerMsg)) {
            return { allowed: true, reason: 'negation_context' };
        }
    }
    
    if (lowerMsg.includes('"') || lowerMsg.includes('\'') || lowerMsg.includes('‘') || lowerMsg.includes('’')) {
        const quotedPattern = new RegExp(`["'‘’][^"''‘’]*${badWord}[^"''‘’]*["'‘’]`, 'i');
        if (quotedPattern.test(lowerMsg)) {
            return { allowed: true, reason: 'quoted_context' };
        }
    }
    
    return { allowed: false, reason: 'flagged' };
}

function advancedModerationCheck(message, username = '') {
    const result = {
        allowed: true,
        blocked: false,
        reason: '',
        severity: 0,
        flaggedWords: []
    };
    
    if (!message || message.trim().length === 0) {
        return result;
    }
    
    if (isSafePhrase(message)) {
        return result;
    }
    
    let normalized = normalizeLeet(message);
    
    for (const pattern of dangerousPatterns) {
        if (pattern.regex.test(normalized)) {
            result.allowed = false;
            result.blocked = true;
            result.reason = pattern.type;
            result.severity = pattern.severity;
            return result;
        }
    }
    
    const words = normalized.split(/\s+/);
    const flaggedWords = [];
    
    for (const word of words) {
        if (word.length < 3) continue;
        if (isAllowlisted(word)) continue;
        
        for (const [bannedWord, config] of bannedWords) {
            if (word.includes(bannedWord) || bannedWord.includes(word)) {
                const contextCheck = checkContext(normalized, bannedWord, config.contexts);
                
                if (contextCheck.allowed) {
                    continue;
                }
                
                flaggedWords.push({
                    word: bannedWord,
                    severity: config.severity,
                    match: word
                });
                
                result.severity = Math.max(result.severity, config.severity);
            }
        }
    }
    
    if (flaggedWords.length > 0) {
        result.flaggedWords = flaggedWords;
        
        if (result.severity >= 8) {
            result.allowed = false;
            result.blocked = true;
            result.reason = 'inappropriate_content_blocked';
        }
        else if (result.severity >= 5) {
            result.allowed = true;
            result.blocked = false;
            result.reason = 'mild_profanity_allowed';
        }
        else {
            result.allowed = true;
            result.blocked = false;
            result.reason = 'minor_issue_ignored';
        }
    }
    
    return result;
}

function filterMessageForDisplay(message, username) {
    const moderation = advancedModerationCheck(message, username);
    
    if (!moderation.allowed) {
        return {
            original: message,
            filtered: "[Message blocked by moderation]",
            blocked: true,
            reason: moderation.reason
        };
    }
    
    let filtered = message;
    if (moderation.severity >= 5 && moderation.severity < 8) {
        for (const flagged of moderation.flaggedWords) {
            const regex = new RegExp(`\\b${flagged.word}\\b`, 'gi');
            filtered = filtered.replace(regex, '*'.repeat(flagged.word.length));
        }
    }
    
    return {
        original: message,
        filtered: filtered,
        blocked: false,
        censored: filtered !== message
    };
}

function logChatMessage(username, originalMessage, filteredMessage, moderationResult) {
    const data = readData();
    if (!data.chatLogs) data.chatLogs = [];
    
    data.chatLogs.unshift({
        id: Date.now(),
        username,
        original: originalMessage,
        filtered: filteredMessage,
        moderation: {
            allowed: moderationResult.allowed,
            blocked: moderationResult.blocked,
            reason: moderationResult.reason,
            severity: moderationResult.severity,
            flaggedWords: moderationResult.flaggedWords
        },
        timestamp: new Date().toISOString()
    });
    
    if (data.chatLogs.length > 1000) {
        data.chatLogs = data.chatLogs.slice(0, 1000);
    }
    
    writeData(data);
}

// ============= CORS CONFIGURATION =============
app.use(cors({
    origin: [FRONTEND_URL, 'http://localhost:3000', 'http://localhost:5500', 'http://127.0.0.1:5500'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With', 'X-Tavian-Token']
}));

app.options('*', cors());
app.use(express.json({ limit: '50mb' })); // Increased for thumbnails
app.use(cookieParser());

// Helper functions
function readData() {
    const data = fs.readFileSync(DATA_FILE);
    return JSON.parse(data);
}

function writeData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function readUsers() {
    return readData().users;
}

function writeUsers(users) {
    const data = readData();
    data.users = users;
    writeData(data);
}

function getNextId() {
    const data = readData();
    const nextId = data.nextId || 1;
    data.nextId = nextId + 1;
    writeData(data);
    return nextId;
}

function generateSecureToken(userId, username) {
    const payload = {
        id: userId,
        username: username,
        timestamp: Date.now(),
        nonce: Math.random().toString(36).substring(2, 15)
    };
    
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
    return token;
}

function verifySecureToken(token) {
    if (!token) return null;
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        return decoded;
    } catch (error) {
        return null;
    }
}

// ============= hCaptcha Verification =============
async function verifyHCaptcha(hcaptchaResponse) {
    if (!hcaptchaResponse) return false;
    
    try {
        const https = require('https');
        const querystring = require('querystring');
        
        const postData = querystring.stringify({
            secret: HCAPTCHA_SECRET,
            response: hcaptchaResponse
        });
        
        const options = {
            hostname: 'hcaptcha.com',
            port: 443,
            path: '/siteverify',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        
        const result = await new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        resolve(json);
                    } catch(e) {
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
            req.write(postData);
            req.end();
        });
        
        return result.success === true;
    } catch (error) {
        console.error('hCaptcha verification error:', error);
        return false;
    }
}

// ============= AUTH MIDDLEWARE =============
function authenticateToken(req, res, next) {
    let token = null;
    
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    }
    
    if (!token && req.headers['x-tavian-token']) {
        token = req.headers['x-tavian-token'];
    }
    
    if (!token) {
        token = req.cookies.TavianSecurity;
    }
    
    if (!token) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const decoded = verifySecureToken(token);
    if (!decoded) {
        return res.status(401).json({ error: 'Invalid token' });
    }
    
    req.user = decoded;
    next();
}

function optionalAuth(req, res, next) {
    let token = null;
    
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    }
    
    if (!token && req.headers['x-tavian-token']) {
        token = req.headers['x-tavian-token'];
    }
    
    if (!token) {
        token = req.cookies.TavianSecurity;
    }
    
    if (token) {
        const decoded = verifySecureToken(token);
        if (decoded) {
            req.user = decoded;
        }
    }
    
    next();
}

function setAuthCookie(res, token) {
    const cookieOptions = {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: '/',
        domain: undefined
    };
    
    res.cookie('TavianSecurity', token, cookieOptions);
}

function clearAuthCookie(res) {
    res.clearCookie('TavianSecurity', {
        path: '/',
        secure: true,
        sameSite: 'none'
    });
}

// ============= API ENDPOINTS =============

// GET all users
app.get('/api/users', optionalAuth, (req, res) => {
    const users = readUsers();
    const safeUsers = users.map(u => {
        const { password, ...safe } = u;
        return safe;
    });
    res.json(safeUsers);
});

// GET user by ID
app.get('/api/users/:id', optionalAuth, (req, res) => {
    const users = readUsers();
    const userId = parseInt(req.params.id);
    const user = users.find(u => u.id === userId);
    
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    const { password, ...safe } = user;
    res.json(safe);
});

// GET current user
app.get('/api/me', authenticateToken, (req, res) => {
    const users = readUsers();
    const user = users.find(u => u.id === req.user.id);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    const { password, ...safe } = user;
    res.json(safe);
});

// Auto-login endpoint
app.get('/api/auto-login', (req, res) => {
    let token = req.cookies.TavianSecurity;
    
    if (!token) {
        return res.status(401).json({ error: 'No session found' });
    }
    
    const decoded = verifySecureToken(token);
    if (!decoded) {
        clearAuthCookie(res);
        return res.status(401).json({ error: 'Invalid session' });
    }
    
    const users = readUsers();
    const user = users.find(u => u.id === decoded.id);
    
    if (!user) {
        clearAuthCookie(res);
        return res.status(401).json({ error: 'User not found' });
    }
    
    const newToken = generateSecureToken(user.id, user.username);
    setAuthCookie(res, newToken);
    
    const { password, ...safe } = user;
    res.json({ success: true, user: safe, token: newToken });
});

// POST register
app.post('/api/register', async (req, res) => {
    const users = readUsers();
    const { username, email, password, displayName, hcaptchaResponse } = req.body;
    
    const isCaptchaValid = await verifyHCaptcha(hcaptchaResponse);
    if (!isCaptchaValid) {
        return res.status(400).json({ error: 'CAPTCHA verification failed. Please try again.' });
    }
    
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
        return res.status(400).json({ error: 'Username already taken' });
    }
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
        return res.status(400).json({ error: 'Email already exists' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const isOwner = username.toLowerCase() === 'realgysj';
    const newId = getNextId();
    
    const newUser = {
        id: newId,
        username,
        email,
        password: hashedPassword,
        displayName: displayName || username,
        tavix: isOwner ? 1000000 : 0,
        about: '',
        visits: 0,
        transactions: [],
        notifications: [{
            id: Date.now(),
            title: "🎉 Welcome to Tavian!",
            message: isOwner ? "You received 1,000,000 TAVIX as owner!" : "Start earning TAVIX by playing games!",
            read: false,
            time: new Date().toISOString()
        }],
        savedDevices: [],
        createdAt: new Date().toISOString()
    };
    
    users.push(newUser);
    writeUsers(users);
    
    const token = generateSecureToken(newUser.id, newUser.username);
    setAuthCookie(res, token);
    
    const { password: _, ...safe } = newUser;
    res.status(201).json(safe);
});

// POST login
app.post('/api/login', async (req, res) => {
    const users = readUsers();
    const { username, password } = req.body;
    
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    const token = generateSecureToken(user.id, user.username);
    setAuthCookie(res, token);
    
    const { password: _, ...safe } = user;
    res.json(safe);
});

// POST logout
app.post('/api/logout', (req, res) => {
    clearAuthCookie(res);
    res.json({ success: true });
});

// ============= PROFILE UPDATE ENDPOINTS =============

// UPDATE user profile by ID - PATCH
app.patch('/api/users/:id/profile', authenticateToken, async (req, res) => {
    const userId = parseInt(req.params.id);
    
    if (req.user.id !== userId) {
        return res.status(403).json({ error: 'Forbidden - Cannot update another user\'s profile' });
    }
    
    const users = readUsers();
    const index = users.findIndex(u => u.id === userId);
    if (index === -1) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    const allowedUpdates = ['displayName', 'about'];
    let updated = false;
    const updates = {};
    
    for (let key of allowedUpdates) {
        if (req.body[key] !== undefined) {
            if (typeof req.body[key] === 'string') {
                let value = req.body[key].trim();
                value = value.replace(/<[^>]*>/g, '');
                value = value.substring(0, 500);
                
                users[index][key] = value;
                updates[key] = value;
                updated = true;
                console.log(`✅ Updated ${key} for user ${users[index].username} to: "${value}"`);
            }
        }
    }
    
    if (!updated) {
        return res.status(400).json({ error: 'No valid fields to update. Allowed: displayName, about' });
    }
    
    writeUsers(users);
    
    const { password, ...safe } = users[index];
    res.json({ 
        success: true, 
        message: 'Profile updated successfully',
        updated: updates,
        user: safe 
    });
});

// UPDATE user settings by ID
app.patch('/api/users/:id/settings', authenticateToken, async (req, res) => {
    const userId = parseInt(req.params.id);
    
    if (req.user.id !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    
    const users = readUsers();
    const index = users.findIndex(u => u.id === userId);
    if (index === -1) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    const allowedUpdates = ['tavix', 'transactions', 'notifications', 'savedDevices', 'visits'];
    let updated = false;
    
    for (let key of allowedUpdates) {
        if (req.body[key] !== undefined) {
            users[index][key] = req.body[key];
            updated = true;
        }
    }
    
    if (!updated) {
        return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    writeUsers(users);
    
    const { password, ...safe } = users[index];
    res.json({ success: true, user: safe });
});

// DELETE user account by ID
app.delete('/api/users/:id/delete', authenticateToken, async (req, res) => {
    const userId = parseInt(req.params.id);
    
    if (req.user.id !== userId) {
        return res.status(403).json({ error: 'Forbidden - Cannot delete another user\'s account' });
    }
    
    let users = readUsers();
    const userToDelete = users.find(u => u.id === userId);
    
    if (!userToDelete) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    users = users.filter(u => u.id !== userId);
    writeUsers(users);
    
    clearAuthCookie(res);
    res.json({ success: true, message: 'Account deleted successfully' });
});

// ============= CHAT ENDPOINTS =============

// POST chat message (with moderation)
app.post('/api/chat', authenticateToken, (req, res) => {
    const { message } = req.body;
    const username = req.user.username;
    
    if (!message || message.trim().length === 0) {
        return res.status(400).json({ error: 'Message cannot be empty' });
    }
    
    if (message.length > 500) {
        return res.status(400).json({ error: 'Message too long (max 500 characters)' });
    }
    
    const moderation = advancedModerationCheck(message, username);
    const filtered = filterMessageForDisplay(message, username);
    
    logChatMessage(username, message, filtered.filtered, moderation);
    
    if (!moderation.allowed) {
        return res.status(403).json({
            error: 'Message blocked by moderation',
            reason: moderation.reason,
            blocked: true
        });
    }
    
    res.json({
        success: true,
        original: message,
        filtered: filtered.filtered,
        censored: filtered.censored,
        username: username,
        timestamp: new Date().toISOString()
    });
});

// Admin endpoint to view moderation logs
app.get('/api/admin/moderation-logs', authenticateToken, (req, res) => {
    const adminUsers = ['realgysj', 'plstealme2'];
    
    if (!adminUsers.includes(req.user.username.toLowerCase())) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    const data = readData();
    const logs = data.chatLogs || [];
    
    res.json({
        total: logs.length,
        logs: logs.slice(0, 100)
    });
});

// ============= TRANSACTION & NOTIFICATION ENDPOINTS =============

// POST transaction
app.post('/api/transaction', authenticateToken, async (req, res) => {
    const { username, amount, reason, from } = req.body;
    
    if (req.user.username !== username) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    
    const users = readUsers();
    const index = users.findIndex(u => u.username === username);
    if (index === -1) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    if (!users[index].transactions) users[index].transactions = [];
    users[index].transactions.unshift({
        id: Date.now(),
        amount,
        reason,
        from: from || null,
        date: new Date().toISOString()
    });
    users[index].tavix = (users[index].tavix || 0) + amount;
    
    if (users[index].transactions.length > 50) users[index].transactions.pop();
    writeUsers(users);
    
    res.json({ success: true, newBalance: users[index].tavix });
});

// POST notification
app.post('/api/notification', authenticateToken, async (req, res) => {
    const { username, title, message } = req.body;
    
    if (req.user.username !== username) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    
    const users = readUsers();
    const index = users.findIndex(u => u.username === username);
    if (index === -1) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    if (!users[index].notifications) users[index].notifications = [];
    users[index].notifications.unshift({
        id: Date.now(),
        title,
        message,
        read: false,
        time: new Date().toISOString()
    });
    
    if (users[index].notifications.length > 50) users[index].notifications.pop();
    writeUsers(users);
    
    res.json({ success: true });
});

// ============= GAME ENDPOINTS (NEW) =============

// Save/Publish a game
app.post('/api/games/publish', authenticateToken, async (req, res) => {
    try {
        const { 
            gameName, 
            description, 
            genre, 
            subgenre, 
            isPublic, 
            thumbnail, 
            gameData 
        } = req.body;
        
        if (!gameName || gameName.trim().length === 0) {
            return res.status(400).json({ error: 'Game name is required' });
        }
        
        if (!gameData) {
            return res.status(400).json({ error: 'Game data is required' });
        }
        
        const gameId = generateGameId();
        const games = readGames();
        
        const newGame = {
            id: gameId,
            name: gameName.trim(),
            description: description || '',
            genre: genre || 'Other',
            subgenre: subgenre || '',
            isPublic: isPublic !== false,
            thumbnail: thumbnail || null,
            gameData: gameData,
            creatorId: req.user.id,
            creatorName: req.user.username,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            plays: 0,
            likes: 0,
            favorites: 0
        };
        
        games.games.push(newGame);
        writeGames(games);
        
        // Add notification to user
        const users = readUsers();
        const userIndex = users.findIndex(u => u.id === req.user.id);
        if (userIndex !== -1) {
            if (!users[userIndex].notifications) users[userIndex].notifications = [];
            users[userIndex].notifications.unshift({
                id: Date.now(),
                title: "🎮 Game Published!",
                message: `Your game "${gameName}" has been published successfully! Game ID: ${gameId}`,
                read: false,
                time: new Date().toISOString()
            });
            writeUsers(users);
        }
        
        res.json({ 
            success: true, 
            gameId: gameId,
            game: {
                id: gameId,
                name: gameName,
                isPublic: isPublic !== false
            }
        });
        
    } catch (error) {
        console.error('Publish error:', error);
        res.status(500).json({ error: 'Failed to publish game' });
    }
});

// Update existing game
app.put('/api/games/:gameId', authenticateToken, async (req, res) => {
    try {
        const gameId = req.params.gameId;
        const { gameName, description, genre, subgenre, isPublic, thumbnail, gameData } = req.body;
        
        const games = readGames();
        const gameIndex = games.games.findIndex(g => g.id === gameId);
        
        if (gameIndex === -1) {
            return res.status(404).json({ error: 'Game not found' });
        }
        
        const game = games.games[gameIndex];
        
        // Check ownership
        if (game.creatorId !== req.user.id) {
            return res.status(403).json({ error: 'Not your game' });
        }
        
        if (gameName) game.name = gameName.trim();
        if (description !== undefined) game.description = description;
        if (genre) game.genre = genre;
        if (subgenre !== undefined) game.subgenre = subgenre;
        if (isPublic !== undefined) game.isPublic = isPublic;
        if (thumbnail) game.thumbnail = thumbnail;
        if (gameData) game.gameData = gameData;
        game.updatedAt = new Date().toISOString();
        
        writeGames(games);
        
        res.json({ success: true, game });
        
    } catch (error) {
        console.error('Update error:', error);
        res.status(500).json({ error: 'Failed to update game' });
    }
});

// Get all public games (for browsing)
app.get('/api/games', optionalAuth, async (req, res) => {
    try {
        const games = readGames();
        const publicGames = games.games.filter(g => g.isPublic === true);
        
        // Remove heavy gameData from list view
        const safeGames = publicGames.map(g => ({
            id: g.id,
            name: g.name,
            description: g.description,
            genre: g.genre,
            subgenre: g.subgenre,
            thumbnail: g.thumbnail,
            creatorName: g.creatorName,
            creatorId: g.creatorId,
            createdAt: g.createdAt,
            updatedAt: g.updatedAt,
            plays: g.plays,
            likes: g.likes,
            favorites: g.favorites
        }));
        
        // Sort by newest first
        safeGames.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        res.json(safeGames);
        
    } catch (error) {
        console.error('Fetch games error:', error);
        res.status(500).json({ error: 'Failed to fetch games' });
    }
});

// Get featured/popular games
app.get('/api/games/featured', optionalAuth, async (req, res) => {
    try {
        const games = readGames();
        const publicGames = games.games.filter(g => g.isPublic === true);
        
        const featured = publicGames
            .sort((a, b) => (b.plays || 0) - (a.plays || 0))
            .slice(0, 10)
            .map(g => ({
                id: g.id,
                name: g.name,
                description: g.description,
                genre: g.genre,
                thumbnail: g.thumbnail,
                creatorName: g.creatorName,
                plays: g.plays,
                likes: g.likes
            }));
        
        res.json(featured);
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch featured games' });
    }
});

// Get single game by ID (full data for playing)
app.get('/api/games/:gameId', optionalAuth, async (req, res) => {
    try {
        const gameId = req.params.gameId;
        const games = readGames();
        const game = games.games.find(g => g.id === gameId);
        
        if (!game) {
            return res.status(404).json({ error: 'Game not found' });
        }
        
        // Check privacy
        if (!game.isPublic && (!req.user || game.creatorId !== req.user.id)) {
            return res.status(403).json({ error: 'This game is private' });
        }
        
        // Increment play count
        game.plays = (game.plays || 0) + 1;
        writeGames(games);
        
        // Return full game data (including gameData for playing)
        res.json({
            id: game.id,
            name: game.name,
            description: game.description,
            genre: game.genre,
            subgenre: game.subgenre,
            isPublic: game.isPublic,
            thumbnail: game.thumbnail,
            gameData: game.gameData,
            creatorName: game.creatorName,
            creatorId: game.creatorId,
            createdAt: game.createdAt,
            updatedAt: game.updatedAt,
            plays: game.plays,
            likes: game.likes
        });
        
    } catch (error) {
        console.error('Fetch game error:', error);
        res.status(500).json({ error: 'Failed to fetch game' });
    }
});

// Get user's own games
app.get('/api/user/games', authenticateToken, async (req, res) => {
    try {
        const games = readGames();
        const userGames = games.games.filter(g => g.creatorId === req.user.id);
        
        const safeGames = userGames.map(g => ({
            id: g.id,
            name: g.name,
            description: g.description,
            genre: g.genre,
            subgenre: g.subgenre,
            isPublic: g.isPublic,
            thumbnail: g.thumbnail,
            createdAt: g.createdAt,
            updatedAt: g.updatedAt,
            plays: g.plays,
            likes: g.likes
        }));
        
        // Sort by most recent first
        safeGames.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        
        res.json(safeGames);
        
    } catch (error) {
        console.error('Fetch user games error:', error);
        res.status(500).json({ error: 'Failed to fetch user games' });
    }
});

// Get games by a specific creator
app.get('/api/games/creator/:creatorId', optionalAuth, async (req, res) => {
    try {
        const creatorId = parseInt(req.params.creatorId);
        const games = readGames();
        const creatorGames = games.games.filter(g => g.creatorId === creatorId && g.isPublic === true);
        
        const safeGames = creatorGames.map(g => ({
            id: g.id,
            name: g.name,
            description: g.description,
            genre: g.genre,
            thumbnail: g.thumbnail,
            plays: g.plays,
            likes: g.likes,
            createdAt: g.createdAt
        }));
        
        res.json(safeGames);
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch creator games' });
    }
});

// Delete game
app.delete('/api/games/:gameId', authenticateToken, async (req, res) => {
    try {
        const gameId = req.params.gameId;
        const games = readGames();
        const gameIndex = games.games.findIndex(g => g.id === gameId);
        
        if (gameIndex === -1) {
            return res.status(404).json({ error: 'Game not found' });
        }
        
        if (games.games[gameIndex].creatorId !== req.user.id) {
            return res.status(403).json({ error: 'Not your game' });
        }
        
        const deletedGame = games.games[gameIndex];
        games.games.splice(gameIndex, 1);
        writeGames(games);
        
        res.json({ 
            success: true, 
            message: `Game "${deletedGame.name}" deleted successfully` 
        });
        
    } catch (error) {
        console.error('Delete game error:', error);
        res.status(500).json({ error: 'Failed to delete game' });
    }
});

// Like/unlike a game
app.post('/api/games/:gameId/like', authenticateToken, async (req, res) => {
    try {
        const gameId = req.params.gameId;
        const games = readGames();
        const gameIndex = games.games.findIndex(g => g.id === gameId);
        
        if (gameIndex === -1) {
            return res.status(404).json({ error: 'Game not found' });
        }
        
        // Simple like increment (in production, track which users liked)
        games.games[gameIndex].likes = (games.games[gameIndex].likes || 0) + 1;
        writeGames(games);
        
        res.json({ 
            success: true, 
            likes: games.games[gameIndex].likes 
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to like game' });
    }
});

// Search games
app.get('/api/games/search/:query', optionalAuth, async (req, res) => {
    try {
        const query = req.params.query.toLowerCase();
        const games = readGames();
        const publicGames = games.games.filter(g => g.isPublic === true);
        
        const results = publicGames.filter(g => 
            g.name.toLowerCase().includes(query) ||
            g.description.toLowerCase().includes(query) ||
            g.genre.toLowerCase().includes(query) ||
            g.creatorName.toLowerCase().includes(query)
        ).map(g => ({
            id: g.id,
            name: g.name,
            description: g.description,
            genre: g.genre,
            thumbnail: g.thumbnail,
            creatorName: g.creatorName,
            plays: g.plays
        }));
        
        res.json(results);
        
    } catch (error) {
        res.status(500).json({ error: 'Search failed' });
    }
});

// Get games by genre
app.get('/api/games/genre/:genre', optionalAuth, async (req, res) => {
    try {
        const genre = req.params.genre;
        const games = readGames();
        const genreGames = games.games.filter(g => g.isPublic === true && g.genre === genre);
        
        const results = genreGames.map(g => ({
            id: g.id,
            name: g.name,
            description: g.description,
            genre: g.genre,
            thumbnail: g.thumbnail,
            creatorName: g.creatorName,
            plays: g.plays
        }));
        
        res.json(results);
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch by genre' });
    }
});

// ============= MIGRATION & UTILITY ENDPOINTS =============

// MIGRATION: Add IDs to existing users
app.post('/api/migrate-ids', (req, res) => {
    const data = readData();
    let changed = false;
    
    data.users.forEach(user => {
        if (!user.id) {
            user.id = data.nextId || 1;
            data.nextId = (data.nextId || 1) + 1;
            changed = true;
        }
    });
    
    if (changed) {
        if (!data.nextId) data.nextId = data.users.length + 1;
        writeData(data);
        res.json({ message: 'IDs added to users', users: data.users.map(u => ({ id: u.id, username: u.username })) });
    } else {
        res.json({ message: 'All users already have IDs', users: data.users.map(u => ({ id: u.id, username: u.username })) });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Debug endpoint - Check user data (admin only)
app.get('/api/debug/user/:id', authenticateToken, (req, res) => {
    const adminUsers = ['realgysj', 'plstealme2'];
    
    if (!adminUsers.includes(req.user.username.toLowerCase())) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    const userId = parseInt(req.params.id);
    const users = readUsers();
    const user = users.find(u => u.id === userId);
    
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        about: user.about,
        tavix: user.tavix,
        email: user.email,
        createdAt: user.createdAt
    });
});

// Debug - List all games (admin only)
app.get('/api/admin/games', authenticateToken, (req, res) => {
    const adminUsers = ['realgysj', 'plstealme2'];
    
    if (!adminUsers.includes(req.user.username.toLowerCase())) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    const games = readGames();
    const gameList = games.games.map(g => ({
        id: g.id,
        name: g.name,
        creatorName: g.creatorName,
        isPublic: g.isPublic,
        plays: g.plays,
        createdAt: g.createdAt
    }));
    
    res.json({ total: gameList.length, games: gameList });
});

// Start server
app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`🟣 Tavian Backend Server (UPDATED with Games API)`);
    console.log(`========================================`);
    console.log(`📡 Running on: http://localhost:${PORT}`);
    console.log(`🔗 Frontend URL: ${FRONTEND_URL}`);
    console.log(`✅ CORS enabled for: ${FRONTEND_URL}`);
    console.log(`✅ Cookie: TavianSecurity (HttpOnly, Secure, SameSite=None)`);
    console.log(`✅ Persistent sessions: 30 days`);
    console.log(`✅ Advanced moderation system: ACTIVE`);
    console.log(`✅ Chat filtering: ENABLED`);
    console.log(`✅ Profile updates: WORKING (PATCH /api/users/:id/profile)`);
    console.log(`✅ Allowed updates: displayName, about`);
    console.log(`✅ GAME API:`);
    console.log(`   - POST   /api/games/publish      - Publish new game`);
    console.log(`   - PUT    /api/games/:gameId     - Update game`);
    console.log(`   - GET    /api/games             - List public games`);
    console.log(`   - GET    /api/games/featured    - Featured games`);
    console.log(`   - GET    /api/games/:gameId     - Get game details`);
    console.log(`   - GET    /api/user/games        - User's games`);
    console.log(`   - DELETE /api/games/:gameId     - Delete game`);
    console.log(`   - GET    /api/games/search/:query - Search games`);
    console.log(`   - GET    /api/games/genre/:genre  - Filter by genre`);
    console.log(`========================================\n`);
});
