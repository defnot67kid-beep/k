const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// ==================== EXE FILE STORAGE SYSTEM ====================
const EXE_STORAGE_DIR = path.join(__dirname, 'exe_files');
const EXE_INDEX_FILE = path.join(__dirname, 'exe_index.json');

// Create directories and files if they don't exist
if (!fs.existsSync(EXE_STORAGE_DIR)) {
    fs.mkdirSync(EXE_STORAGE_DIR, { recursive: true });
    console.log('✅ Created exe_files directory');
}

if (!fs.existsSync(EXE_INDEX_FILE)) {
    fs.writeFileSync(EXE_INDEX_FILE, JSON.stringify({ files: [], nextId: 1 }, null, 2));
    console.log('✅ Created exe_index.json');
}

// Multer configuration for .exe file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, EXE_STORAGE_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage, 
    limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit
});

// Helper functions for EXE index
function readExeIndex() {
    try {
        const data = fs.readFileSync(EXE_INDEX_FILE);
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading exe index:', error);
        return { files: [], nextId: 1 };
    }
}

function writeExeIndex(data) {
    fs.writeFileSync(EXE_INDEX_FILE, JSON.stringify(data, null, 2));
}

// ==================== ENHANCED BINARY STORAGE FOR GAME DATA ====================
const BINARY_STORAGE_DIR = path.join(__dirname, 'game_binaries');

if (!fs.existsSync(BINARY_STORAGE_DIR)) {
    fs.mkdirSync(BINARY_STORAGE_DIR, { recursive: true });
    console.log('✅ Created game_binaries directory for binary storage');
}

// Save game data as binary file
function saveGameBinary(gameId, gameData) {
    const binaryPath = path.join(BINARY_STORAGE_DIR, `${gameId}.dat`);
    // Convert game data to binary buffer
    const dataBuffer = Buffer.from(JSON.stringify(gameData), 'utf-8');
    fs.writeFileSync(binaryPath, dataBuffer);
    console.log(`💾 Binary saved: ${gameId}.dat (${dataBuffer.length} bytes)`);
    return binaryPath;
}

// Load game data from binary file
function loadGameBinary(gameId) {
    const binaryPath = path.join(BINARY_STORAGE_DIR, `${gameId}.dat`);
    if (!fs.existsSync(binaryPath)) return null;
    const dataBuffer = fs.readFileSync(binaryPath);
    return JSON.parse(dataBuffer.toString('utf-8'));
}

// Delete game binary file
function deleteGameBinary(gameId) {
    const binaryPath = path.join(BINARY_STORAGE_DIR, `${gameId}.dat`);
    if (fs.existsSync(binaryPath)) {
        fs.unlinkSync(binaryPath);
        console.log(`🗑️ Binary deleted: ${gameId}.dat`);
    }
}

// ==================== ORIGINAL GAME API (PRESERVED & ENHANCED) ====================
const GAMES_FILE = path.join(__dirname, 'games.json');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const INSTALLER_PATH = path.join(DOWNLOADS_DIR, 'TavianSetup.exe');

// Create downloads directory if it doesn't exist
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    console.log('✅ Created downloads directory');
}

// Initialize games.json if it doesn't exist
if (!fs.existsSync(GAMES_FILE)) {
    fs.writeFileSync(GAMES_FILE, JSON.stringify({ 
        games: [], 
        nextId: 100000000,
        publishedAt: new Date().toISOString()
    }, null, 2));
    console.log('✅ Created games.json file');
}

// Helper functions for games
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

// ==================== EXE API ENDPOINTS ====================

// Get all uploaded .exe files
app.get('/api/exe/list', (req, res) => {
    try {
        const index = readExeIndex();
        const files = index.files.map(f => ({
            id: f.id,
            name: f.originalName,
            size: f.size,
            uploadedAt: f.uploadedAt
        }));
        res.json(files);
    } catch (error) {
        console.error('❌ Error listing exe files:', error);
        res.status(500).json({ error: 'Failed to list files: ' + error.message });
    }
});

// Upload a new .exe file
app.post('/api/exe/upload', upload.single('exeFile'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No .exe file provided' });
        }

        const originalName = req.body.name || req.file.originalname;
        
        // Validate it's an .exe file
        if (!originalName.toLowerCase().endsWith('.exe') && !req.file.originalname.toLowerCase().endsWith('.exe')) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Only .exe files are allowed' });
        }

        const index = readExeIndex();
        const newId = index.nextId || 1;
        
        const newEntry = {
            id: newId,
            originalName: originalName,
            storedFilename: req.file.filename,
            size: req.file.size,
            uploadedAt: new Date().toISOString()
        };
        
        index.files.push(newEntry);
        index.nextId = newId + 1;
        writeExeIndex(index);
        
        console.log(`✅ EXE uploaded: ${originalName} (ID: ${newId}, Size: ${req.file.size} bytes)`);
        
        res.json({ 
            success: true, 
            id: newId, 
            name: originalName,
            size: req.file.size,
            message: 'File uploaded successfully'
        });
        
    } catch (error) {
        console.error('❌ Upload error:', error);
        res.status(500).json({ error: 'Failed to upload file: ' + error.message });
    }
});

// Download an .exe file by ID
app.get('/api/exe/download/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const index = readExeIndex();
        const entry = index.files.find(f => f.id === id);
        
        if (!entry) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        const filePath = path.join(EXE_STORAGE_DIR, entry.storedFilename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File missing on server' });
        }
        
        res.download(filePath, entry.originalName);
        console.log(`📥 Download: ${entry.originalName}`);
        
    } catch (error) {
        console.error('❌ Download error:', error);
        res.status(500).json({ error: 'Failed to download file' });
    }
});

// Delete an .exe file by ID
app.delete('/api/exe/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const index = readExeIndex();
        const fileIndex = index.files.findIndex(f => f.id === id);
        
        if (fileIndex === -1) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        const entry = index.files[fileIndex];
        const filePath = path.join(EXE_STORAGE_DIR, entry.storedFilename);
        
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        
        index.files.splice(fileIndex, 1);
        writeExeIndex(index);
        
        console.log(`🗑️ Deleted EXE: ${entry.originalName} (ID: ${id})`);
        res.json({ success: true, message: 'File deleted successfully' });
        
    } catch (error) {
        console.error('❌ Delete error:', error);
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

// ==================== ENHANCED GAME API ENDPOINTS ====================

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Tavian Studio API is running with EXE and Binary support!',
        endpoints: [
            '📦 EXE Management:',
            '  GET    /api/exe/list     - List all .exe files',
            '  POST   /api/exe/upload   - Upload .exe file',
            '  GET    /api/exe/download/:id - Download .exe file',
            '  DELETE /api/exe/:id      - Delete .exe file',
            '',
            '🎮 Game Management (Enhanced Binary Storage):',
            '  POST   /api/games/publish - Publish a new game (saves ALL explorer data)',
            '  GET    /api/games        - Get all public games',
            '  GET    /api/games/:gameId - Get specific game with FULL explorer data',
            '  GET    /api/games/:gameId/data - Get ONLY the binary game data',
            '  DELETE /api/games/:gameId - Delete a game',
            '  GET    /api/games/:gameId/export - Export game as binary download',
            '',
            '📥 Installer:',
            '  GET    /download         - Download Tavian installer',
            '  GET    /api/installer    - Get installer info',
            '',
            '🔧 Utilities:',
            '  GET    /api/health       - Health check',
            '  GET    /api/stats        - Get statistics'
        ],
        timestamp: new Date().toISOString()
    });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Download Tavian installer
app.get('/download', (req, res) => {
    try {
        if (!fs.existsSync(INSTALLER_PATH)) {
            return res.status(404).json({ 
                error: 'Installer not found. Please upload TavianSetup.exe to the downloads folder.',
                help: 'Create a "downloads" folder and place TavianSetup.exe there'
            });
        }
        res.download(INSTALLER_PATH, 'TavianSetup.exe');
        console.log('📥 Installer downloaded');
    } catch (error) {
        console.error('❌ Download error:', error);
        res.status(500).json({ error: 'Failed to download installer' });
    }
});

// Installer information
app.get('/api/installer', (req, res) => {
    const exists = fs.existsSync(INSTALLER_PATH);
    res.json({
        name: 'Tavian',
        version: '1.0.0',
        downloadUrl: `${req.protocol}://${req.get('host')}/download`,
        available: exists,
        message: exists ? 'Installer ready for download' : 'Installer not uploaded yet'
    });
});

// ENHANCED: Publish a new game with ALL explorer data (skybox, movement, grid are NOT saved - only explorer items)
app.post('/api/games/publish', (req, res) => {
    try {
        console.log('📥 Received publish request');
        const { gameName, description, genre, subgenre, isPublic, thumbnail, gameData, explorerData } = req.body;
        
        // Validation
        if (!gameName || gameName.trim().length === 0) {
            return res.status(400).json({ error: 'Game name is required' });
        }
        
        if (!gameData && !explorerData) {
            return res.status(400).json({ error: 'Game data is required' });
        }
        
        // Generate unique 9+ digit game ID
        const gameId = generateGameId();
        const games = readGames();
        
        // Extract ONLY explorer items (parts, scripts, folders, spawns) - NO skybox, movement, grid
        const filteredGameData = explorerData || gameData;
        
        // Save to binary storage
        saveGameBinary(gameId, filteredGameData);
        
        // Create game object with minimal metadata
        const newGame = {
            id: gameId,
            name: gameName.trim(),
            description: description || '',
            genre: genre || 'Other',
            subgenre: subgenre || '',
            isPublic: isPublic !== false,
            thumbnail: thumbnail || null,
            hasBinaryData: true,
            binarySize: fs.statSync(path.join(BINARY_STORAGE_DIR, `${gameId}.dat`)).size,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            plays: 0,
            likes: 0,
            // Extract object count from explorer data
            objectCount: filteredGameData.objects ? filteredGameData.objects.length : 0
        };
        
        games.games.push(newGame);
        writeGames(games);
        
        console.log(`✅ Game published: ${gameName} (ID: ${gameId}) with ${newGame.objectCount} objects in binary`);
        
        res.json({ 
            success: true, 
            message: 'Game published successfully!',
            gameId: gameId,
            game: {
                id: gameId,
                name: gameName,
                isPublic: isPublic !== false,
                createdAt: newGame.createdAt,
                objectCount: newGame.objectCount,
                binarySize: newGame.binarySize
            }
        });
        
    } catch (error) {
        console.error('❌ Publish error:', error);
        res.status(500).json({ error: 'Failed to publish game: ' + error.message });
    }
});

// Get all public games (metadata only, no binary data)
app.get('/api/games', (req, res) => {
    try {
        const games = readGames();
        const publicGames = games.games.filter(g => g.isPublic === true);
        
        const safeGames = publicGames.map(g => ({
            id: g.id,
            name: g.name,
            description: g.description,
            genre: g.genre,
            subgenre: g.subgenre,
            thumbnail: g.thumbnail,
            createdAt: g.createdAt,
            plays: g.plays,
            likes: g.likes,
            objectCount: g.objectCount || 0,
            binarySize: g.binarySize || 0,
            hasBinaryData: g.hasBinaryData || false
        }));
        
        safeGames.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        res.json(safeGames);
        
    } catch (error) {
        console.error('❌ Fetch games error:', error);
        res.status(500).json({ error: 'Failed to fetch games' });
    }
});

// Get single game by ID with FULL explorer data (from binary)
app.get('/api/games/:gameId', (req, res) => {
    try {
        const gameId = req.params.gameId;
        const games = readGames();
        const game = games.games.find(g => g.id === gameId);
        
        if (!game) {
            return res.status(404).json({ error: 'Game not found' });
        }
        
        // Increment play count
        game.plays = (game.plays || 0) + 1;
        writeGames(games);
        
        // Load binary data
        const binaryData = loadGameBinary(gameId);
        
        if (!binaryData && game.gameData) {
            // Fallback to old JSON data if binary doesn't exist
            console.log(`⚠️ Binary not found for ${gameId}, using JSON fallback`);
        }
        
        res.json({
            id: game.id,
            name: game.name,
            description: game.description,
            genre: game.genre,
            subgenre: game.subgenre,
            isPublic: game.isPublic,
            thumbnail: game.thumbnail,
            gameData: binaryData || game.gameData, // Return binary data or fallback
            explorerData: binaryData, // Separate field for explorer data
            createdAt: game.createdAt,
            plays: game.plays,
            likes: game.likes,
            objectCount: game.objectCount || 0,
            binarySize: game.binarySize || 0
        });
        
    } catch (error) {
        console.error('❌ Fetch game error:', error);
        res.status(500).json({ error: 'Failed to fetch game' });
    }
});

// NEW: Get ONLY the binary game data (for direct download)
app.get('/api/games/:gameId/data', (req, res) => {
    try {
        const gameId = req.params.gameId;
        const binaryPath = path.join(BINARY_STORAGE_DIR, `${gameId}.dat`);
        
        if (!fs.existsSync(binaryPath)) {
            return res.status(404).json({ error: 'Binary data not found' });
        }
        
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="game_${gameId}.dat"`);
        res.sendFile(binaryPath);
        
    } catch (error) {
        console.error('❌ Binary download error:', error);
        res.status(500).json({ error: 'Failed to download binary data' });
    }
});

// NEW: Export game as full binary package
app.get('/api/games/:gameId/export', (req, res) => {
    try {
        const gameId = req.params.gameId;
        const games = readGames();
        const game = games.games.find(g => g.id === gameId);
        
        if (!game) {
            return res.status(404).json({ error: 'Game not found' });
        }
        
        const binaryData = loadGameBinary(gameId);
        
        const exportPackage = {
            metadata: {
                id: game.id,
                name: game.name,
                description: game.description,
                genre: game.genre,
                subgenre: game.subgenre,
                createdAt: game.createdAt,
                objectCount: game.objectCount || 0
            },
            gameData: binaryData
        };
        
        const exportBuffer = Buffer.from(JSON.stringify(exportPackage), 'utf-8');
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${game.name.replace(/[^a-z0-9]/gi, '_')}.tavian"`);
        res.send(exportBuffer);
        
    } catch (error) {
        console.error('❌ Export error:', error);
        res.status(500).json({ error: 'Failed to export game' });
    }
});

// Delete a game (also delete binary)
app.delete('/api/games/:gameId', (req, res) => {
    try {
        const gameId = req.params.gameId;
        const games = readGames();
        const gameIndex = games.games.findIndex(g => g.id === gameId);
        
        if (gameIndex === -1) {
            return res.status(404).json({ error: 'Game not found' });
        }
        
        const deletedGame = games.games[gameIndex];
        games.games.splice(gameIndex, 1);
        writeGames(games);
        
        // Delete binary data
        deleteGameBinary(gameId);
        
        console.log(`🗑️ Game deleted: ${deletedGame.name} (ID: ${gameId})`);
        
        res.json({ success: true, message: `Game "${deletedGame.name}" deleted` });
        
    } catch (error) {
        console.error('❌ Delete error:', error);
        res.status(500).json({ error: 'Failed to delete game' });
    }
});

// Get statistics
app.get('/api/stats', (req, res) => {
    try {
        const games = readGames();
        const exeIndex = readExeIndex();
        const totalGames = games.games.length;
        const publicGames = games.games.filter(g => g.isPublic === true).length;
        const totalPlays = games.games.reduce((sum, g) => sum + (g.plays || 0), 0);
        const totalObjects = games.games.reduce((sum, g) => sum + (g.objectCount || 0), 0);
        
        // Calculate binary storage size
        let binaryTotalSize = 0;
        if (fs.existsSync(BINARY_STORAGE_DIR)) {
            const binaryFiles = fs.readdirSync(BINARY_STORAGE_DIR);
            binaryTotalSize = binaryFiles.reduce((sum, file) => {
                const stat = fs.statSync(path.join(BINARY_STORAGE_DIR, file));
                return sum + stat.size;
            }, 0);
        }
        
        res.json({ 
            games: { 
                totalGames, 
                publicGames, 
                totalPlays, 
                totalObjects,
                lastPublished: games.publishedAt 
            },
            exeFiles: { 
                total: exeIndex.files.length, 
                storagePath: EXE_STORAGE_DIR 
            },
            binaryStorage: {
                totalSizeBytes: binaryTotalSize,
                totalSizeMB: (binaryTotalSize / 1024 / 1024).toFixed(2),
                path: BINARY_STORAGE_DIR
            }
        });
        
    } catch (error) {
        console.error('❌ Stats error:', error);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

// ==================== START SERVER ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║     🟣 Tavian Studio API Server - ENHANCED BINARY STORAGE        ║
╠═══════════════════════════════════════════════════════════════════╣
║  📡 Running on: http://0.0.0.0:${PORT}                            ║
║  ✅ CORS enabled                                                  ║
║  📦 EXE files stored in: ${EXE_STORAGE_DIR}                      ║
║  💾 Binary games stored in: ${BINARY_STORAGE_DIR}                ║
║  🎮 Games metadata stored in: games.json                         ║
╠═══════════════════════════════════════════════════════════════════╣
║  📌 WHAT GETS SAVED (Explorer Items Only):                       ║
║  ✅ Parts (position, rotation, scale, color)                     ║
║  ✅ Scripts (name, code)                                         ║
║  ✅ Folders (name, hierarchy)                                    ║
║  ✅ SpawnPoints (position)                                       ║
║  ✅ Parent-child relationships                                   ║
║  ✅ Object names and IDs                                         ║
╠═══════════════════════════════════════════════════════════════════╣
║  📌 WHAT IS NOT SAVED:                                           ║
║  ❌ Skybox                                                        ║
║  ❌ Movement/Camera controls                                     ║
║  ❌ Grid helper                                                  ║
║  ❌ Editor UI state                                              ║
╠═══════════════════════════════════════════════════════════════════╣
║  🎮 ENHANCED GAME ENDPOINTS:                                     ║
║  POST   /api/games/publish     - Save ALL explorer data         ║
║  GET    /api/games             - List all public games          ║
║  GET    /api/games/:id         - Get FULL explorer data         ║
║  GET    /api/games/:id/data    - Download raw binary            ║
║  GET    /api/games/:id/export  - Export as .tavian package      ║
║  DELETE /api/games/:id         - Delete game                    ║
║  GET    /api/stats             - Get statistics                 ║
╚═══════════════════════════════════════════════════════════════════╝
    `);
});
