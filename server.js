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

// ==================== FILE STORAGE SYSTEMS ====================
const EXE_STORAGE_DIR = path.join(__dirname, 'exe_files');
const GLTF_STORAGE_DIR = path.join(__dirname, 'gltf_files');
const EXE_INDEX_FILE = path.join(__dirname, 'exe_index.json');
const GLTF_INDEX_FILE = path.join(__dirname, 'gltf_index.json');

// Create directories and files if they don't exist
if (!fs.existsSync(EXE_STORAGE_DIR)) {
    fs.mkdirSync(EXE_STORAGE_DIR, { recursive: true });
    console.log('✅ Created exe_files directory');
}

if (!fs.existsSync(GLTF_STORAGE_DIR)) {
    fs.mkdirSync(GLTF_STORAGE_DIR, { recursive: true });
    console.log('✅ Created gltf_files directory');
}

if (!fs.existsSync(EXE_INDEX_FILE)) {
    fs.writeFileSync(EXE_INDEX_FILE, JSON.stringify({ files: [], nextId: 1 }, null, 2));
    console.log('✅ Created exe_index.json');
}

if (!fs.existsSync(GLTF_INDEX_FILE)) {
    fs.writeFileSync(GLTF_INDEX_FILE, JSON.stringify({ files: [], nextId: 1 }, null, 2));
    console.log('✅ Created gltf_index.json');
}

// Multer configurations
const exeStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, EXE_STORAGE_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '.exe');
    }
});

const gltfStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, GLTF_STORAGE_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, uniqueSuffix + ext);
    }
});

const uploadEXE = multer({ 
    storage: exeStorage, 
    limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit
});

const uploadGLTF = multer({ 
    storage: gltfStorage, 
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.gltf', '.glb', '.obj', '.fbx', '.mtl'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only GLTF, GLB, OBJ, FBX, and MTL files are allowed'));
        }
    }
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

// Helper functions for GLTF index
function readGltfIndex() {
    try {
        const data = fs.readFileSync(GLTF_INDEX_FILE);
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading gltf index:', error);
        return { files: [], nextId: 1 };
    }
}

function writeGltfIndex(data) {
    fs.writeFileSync(GLTF_INDEX_FILE, JSON.stringify(data, null, 2));
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
app.post('/api/exe/upload', uploadEXE.single('exeFile'), (req, res) => {
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

// ==================== GLTF/3D MODEL API ENDPOINTS ====================

// Get all uploaded 3D models
app.get('/api/gltf/list', (req, res) => {
    try {
        const index = readGltfIndex();
        const files = index.files.map(f => ({
            id: f.id,
            name: f.originalName,
            type: f.fileType,
            size: f.size,
            uploadedAt: f.uploadedAt
        }));
        res.json(files);
    } catch (error) {
        console.error('❌ Error listing 3D models:', error);
        res.status(500).json({ error: 'Failed to list models: ' + error.message });
    }
});

// Upload a new 3D model (GLTF, GLB, OBJ)
app.post('/api/gltf/upload', uploadGLTF.single('modelFile'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No model file provided' });
        }

        const originalName = req.body.name || req.file.originalname;
        const fileExt = path.extname(originalName).toLowerCase();
        
        // Validate file type
        const allowedExt = ['.gltf', '.glb', '.obj', '.fbx', '.mtl'];
        if (!allowedExt.includes(fileExt)) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Invalid file type. Allowed: GLTF, GLB, OBJ, FBX, MTL' });
        }

        const index = readGltfIndex();
        const newId = index.nextId || 1;
        
        const newEntry = {
            id: newId,
            originalName: originalName,
            storedFilename: req.file.filename,
            fileType: fileExt.substring(1).toUpperCase(),
            size: req.file.size,
            uploadedAt: new Date().toISOString()
        };
        
        index.files.push(newEntry);
        index.nextId = newId + 1;
        writeGltfIndex(index);
        
        console.log(`✅ 3D Model uploaded: ${originalName} (ID: ${newId}, Type: ${newEntry.fileType}, Size: ${req.file.size} bytes)`);
        
        res.json({ 
            success: true, 
            id: newId, 
            name: originalName,
            type: newEntry.fileType,
            size: req.file.size,
            message: '3D model uploaded successfully'
        });
        
    } catch (error) {
        console.error('❌ Upload error:', error);
        res.status(500).json({ error: 'Failed to upload model: ' + error.message });
    }
});

// Download a 3D model by ID
app.get('/api/gltf/download/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const index = readGltfIndex();
        const entry = index.files.find(f => f.id === id);
        
        if (!entry) {
            return res.status(404).json({ error: 'Model not found' });
        }
        
        const filePath = path.join(GLTF_STORAGE_DIR, entry.storedFilename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Model file missing on server' });
        }
        
        res.download(filePath, entry.originalName);
        console.log(`📥 Download: ${entry.originalName} (${entry.fileType})`);
        
    } catch (error) {
        console.error('❌ Download error:', error);
        res.status(500).json({ error: 'Failed to download model' });
    }
});

// Delete a 3D model by ID
app.delete('/api/gltf/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const index = readGltfIndex();
        const fileIndex = index.files.findIndex(f => f.id === id);
        
        if (fileIndex === -1) {
            return res.status(404).json({ error: 'Model not found' });
        }
        
        const entry = index.files[fileIndex];
        const filePath = path.join(GLTF_STORAGE_DIR, entry.storedFilename);
        
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        
        index.files.splice(fileIndex, 1);
        writeGltfIndex(index);
        
        console.log(`🗑️ Deleted 3D Model: ${entry.originalName} (ID: ${id})`);
        res.json({ success: true, message: 'Model deleted successfully' });
        
    } catch (error) {
        console.error('❌ Delete error:', error);
        res.status(500).json({ error: 'Failed to delete model' });
    }
});

// ==================== ENHANCED GAME STORAGE ====================
const GAMES_FILE = path.join(__dirname, 'games.json');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const INSTALLER_PATH = path.join(DOWNLOADS_DIR, 'TavianSetup.exe');

if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    console.log('✅ Created downloads directory');
}

if (!fs.existsSync(GAMES_FILE)) {
    fs.writeFileSync(GAMES_FILE, JSON.stringify({ 
        games: [], 
        nextId: 100000000,
        publishedAt: new Date().toISOString()
    }, null, 2));
    console.log('✅ Created games.json file');
}

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

// ==================== GAME API ENDPOINTS ====================

app.get('/', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Tavian Studio API is running with GLTF/GLB Support!',
        endpoints: [
            '📦 EXE Management:',
            '  GET    /api/exe/list     - List all .exe files',
            '  POST   /api/exe/upload   - Upload .exe file',
            '  GET    /api/exe/download/:id - Download .exe file',
            '  DELETE /api/exe/:id      - Delete .exe file',
            '',
            '🎨 3D Model Management (GLTF/GLB/OBJ):',
            '  GET    /api/gltf/list    - List all 3D models',
            '  POST   /api/gltf/upload  - Upload 3D model',
            '  GET    /api/gltf/download/:id - Download 3D model',
            '  DELETE /api/gltf/:id     - Delete 3D model',
            '',
            '🎮 Game Management:',
            '  POST   /api/games/publish - Publish a new game (FULL DATA)',
            '  GET    /api/games        - Get all public games',
            '  GET    /api/games/:gameId - Get specific game with FULL DATA',
            '  DELETE /api/games/:gameId - Delete a game',
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

// ==================== ENHANCED PUBLISH ENDPOINT ====================
app.post('/api/games/publish', (req, res) => {
    try {
        console.log('📥 Received publish request with enhanced data');
        
        const { 
            gameName, 
            description, 
            genre, 
            subgenre, 
            isPublic, 
            thumbnail, 
            gameData
        } = req.body;
        
        // Validation
        if (!gameName || gameName.trim().length === 0) {
            return res.status(400).json({ error: 'Game name is required' });
        }
        
        if (!gameData) {
            return res.status(400).json({ error: 'Game data is required' });
        }
        
        // Validate that gameData contains explorer structure
        if (!gameData.objects || !Array.isArray(gameData.objects)) {
            return res.status(400).json({ error: 'Invalid game data format - missing objects array' });
        }
        
        console.log(`📊 Game data contains: ${gameData.objects.length} objects in explorer`);
        
        // Generate unique 9+ digit game ID
        const gameId = generateGameId();
        const games = readGames();
        
        // Create enhanced game object with FULL data
        const newGame = {
            id: gameId,
            name: gameName.trim(),
            description: description || '',
            genre: genre || 'Other',
            subgenre: subgenre || '',
            isPublic: isPublic !== false,
            thumbnail: thumbnail || null,
            
            // FULL GAME DATA - everything from explorer!
            gameData: {
                version: gameData.version || "1.0",
                savedAt: gameData.savedAt || new Date().toISOString(),
                objects: gameData.objects,  // All objects with all properties!
                workspace: gameData.workspace || null
            },
            
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            plays: 0,
            likes: 0,
            downloads: 0
        };
        
        games.games.push(newGame);
        writeGames(games);
        
        console.log(`✅ Game published: ${gameName} (ID: ${gameId})`);
        console.log(`   📦 Objects in game: ${gameData.objects.length}`);
        console.log(`   🖼️ Thumbnail: ${thumbnail ? 'Yes' : 'No'}`);
        console.log(`   🌐 Public: ${isPublic !== false}`);
        
        res.json({ 
            success: true, 
            message: 'Game published successfully with full data!',
            gameId: gameId,
            game: {
                id: gameId,
                name: gameName,
                isPublic: isPublic !== false,
                createdAt: newGame.createdAt,
                objectCount: gameData.objects.length
            }
        });
        
    } catch (error) {
        console.error('❌ Publish error:', error);
        res.status(500).json({ error: 'Failed to publish game: ' + error.message });
    }
});

// Get all public games (metadata only)
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
            downloads: g.downloads || 0,
            objectCount: g.gameData?.objects?.length || 0
        }));
        
        safeGames.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        res.json(safeGames);
        
    } catch (error) {
        console.error('❌ Fetch games error:', error);
        res.status(500).json({ error: 'Failed to fetch games' });
    }
});

// Get single game by ID with FULL DATA
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
        
        // Return FULL game data including all explorer objects
        res.json({
            id: game.id,
            name: game.name,
            description: game.description,
            genre: game.genre,
            subgenre: game.subgenre,
            isPublic: game.isPublic,
            thumbnail: game.thumbnail,
            gameData: game.gameData,  // FULL data with all objects!
            createdAt: game.createdAt,
            plays: game.plays,
            likes: game.likes,
            downloads: game.downloads || 0
        });
        
        console.log(`🎮 Game loaded: ${game.name} (ID: ${gameId}) - Objects: ${game.gameData?.objects?.length || 0}`);
        
    } catch (error) {
        console.error('❌ Fetch game error:', error);
        res.status(500).json({ error: 'Failed to fetch game' });
    }
});

// Delete a game
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
        const gltfIndex = readGltfIndex();
        const totalGames = games.games.length;
        const publicGames = games.games.filter(g => g.isPublic === true).length;
        const totalPlays = games.games.reduce((sum, g) => sum + (g.plays || 0), 0);
        const totalObjects = games.games.reduce((sum, g) => sum + (g.gameData?.objects?.length || 0), 0);
        
        res.json({ 
            games: { 
                totalGames, 
                publicGames, 
                totalPlays, 
                totalObjects,
                lastPublished: games.publishedAt 
            },
            exeFiles: { total: exeIndex.files.length, storagePath: EXE_STORAGE_DIR },
            gltfFiles: { total: gltfIndex.files.length, storagePath: GLTF_STORAGE_DIR }
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
║     🟣 Tavian Studio API Server - FULL 3D MODEL SUPPORT          ║
╠═══════════════════════════════════════════════════════════════════╣
║  📡 Running on: http://0.0.0.0:${PORT}                            ║
║  ✅ CORS enabled                                                  ║
║  📦 EXE files stored in: ${EXE_STORAGE_DIR}                      ║
║  🎨 GLTF/GLB files stored in: ${GLTF_STORAGE_DIR}                ║
║  🎮 Games stored in: games.json                                   ║
╠═══════════════════════════════════════════════════════════════════╣
║  🆕 NEW FEATURES:                                                 ║
║  ✓ Full GLTF/GLB/OBJ upload support                              ║
║  ✓ Proper file validation for 3D models                          ║
║  ✓ Separate storage for models and executables                   ║
║  ✓ File type detection and tracking                              ║
╠═══════════════════════════════════════════════════════════════════╣
║  📌 EXE ENDPOINTS:                                                ║
║  GET    /api/exe/list       - List all .exe files                ║
║  POST   /api/exe/upload     - Upload .exe file                   ║
║  GET    /api/exe/download/:id - Download .exe                    ║
║  DELETE /api/exe/:id        - Delete .exe file                   ║
╠═══════════════════════════════════════════════════════════════════╣
║  🎨 3D MODEL ENDPOINTS:                                           ║
║  GET    /api/gltf/list      - List all 3D models                 ║
║  POST   /api/gltf/upload    - Upload GLTF/GLB/OBJ                ║
║  GET    /api/gltf/download/:id - Download model                  ║
║  DELETE /api/gltf/:id       - Delete model                       ║
╠═══════════════════════════════════════════════════════════════════╣
║  🎮 GAME ENDPOINTS:                                               ║
║  POST   /api/games/publish  - Publish game (FULL DATA)           ║
║  GET    /api/games          - List public games (metadata)       ║
║  GET    /api/games/:id      - Get game with FULL DATA            ║
║  DELETE /api/games/:id      - Delete game                        ║
║  GET    /api/stats          - Get statistics                     ║
║  GET    /api/installer      - Get installer info                 ║
║  GET    /download           - Download installer                 ║
║  GET    /api/health         - Health check                       ║
╚═══════════════════════════════════════════════════════════════════╝
    `);
});
