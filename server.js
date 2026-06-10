const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: '*', // Allow all origins for testing
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Data file path
const GAMES_FILE = path.join(__dirname, 'games.json');

// Installer paths
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const INSTALLER_PATH = path.join(DOWNLOADS_DIR, 'TavianSetup.exe');

if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// Initialize games file
if (!fs.existsSync(GAMES_FILE)) {
    fs.writeFileSync(GAMES_FILE, JSON.stringify({ 
        games: [], 
        nextId: 100000000,
        publishedAt: new Date().toISOString()
    }, null, 2));
    console.log('✅ Created games.json file');
}

// Helper functions
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

// ============= GAME API ENDPOINTS =============

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Tavian Studio API is running!',
        endpoints: [
            'POST /api/games/publish - Publish a new game',
            'GET /api/games - Get all public games',
            'GET /api/games/:gameId - Get a specific game',
            'GET /api/installer - Get installer info',
            'GET /download - Download Tavian installer',
            'GET /api/health - Health check'
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
                error: 'Installer not found'
            });
        }

        res.download(INSTALLER_PATH, 'TavianSetup.exe');

    } catch (error) {
        console.error('❌ Download error:', error);
        res.status(500).json({
            error: 'Failed to download installer'
        });
    }
});

// Installer information
app.get('/api/installer', (req, res) => {
    res.json({
        name: 'Tavian',
        version: '1.0.0',
        downloadUrl: `${req.protocol}://${req.get('host')}/download`
    });
});

// Publish a new game
app.post('/api/games/publish', (req, res) => {
    try {
        console.log('📥 Received publish request');
        const { gameName, description, genre, subgenre, isPublic, thumbnail, gameData } = req.body;
        
        // Validation
        if (!gameName || gameName.trim().length === 0) {
            return res.status(400).json({ error: 'Game name is required' });
        }
        
        if (!gameData) {
            return res.status(400).json({ error: 'Game data is required' });
        }
        
        // Generate unique 9+ digit game ID
        const gameId = generateGameId();
        const games = readGames();
        
        // Create game object
        const newGame = {
            id: gameId,
            name: gameName.trim(),
            description: description || '',
            genre: genre || 'Other',
            subgenre: subgenre || '',
            isPublic: isPublic !== false,
            thumbnail: thumbnail || null,
            gameData: gameData,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            plays: 0,
            likes: 0
        };
        
        games.games.push(newGame);
        writeGames(games);
        
        console.log(`✅ Game published: ${gameName} (ID: ${gameId})`);
        
        res.json({ 
            success: true, 
            message: 'Game published successfully!',
            gameId: gameId,
            game: {
                id: gameId,
                name: gameName,
                isPublic: isPublic !== false,
                createdAt: newGame.createdAt
            }
        });
        
    } catch (error) {
        console.error('❌ Publish error:', error);
        res.status(500).json({ error: 'Failed to publish game: ' + error.message });
    }
});

// Get all public games
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
            likes: g.likes
        }));
        
        safeGames.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        res.json(safeGames);
        
    } catch (error) {
        console.error('❌ Fetch games error:', error);
        res.status(500).json({ error: 'Failed to fetch games' });
    }
});

// Get single game by ID
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
        
        res.json({
            id: game.id,
            name: game.name,
            description: game.description,
            genre: game.genre,
            subgenre: game.subgenre,
            isPublic: game.isPublic,
            thumbnail: game.thumbnail,
            gameData: game.gameData,
            createdAt: game.createdAt,
            plays: game.plays,
            likes: game.likes
        });
        
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
        const totalGames = games.games.length;
        const publicGames = games.games.filter(g => g.isPublic === true).length;
        const totalPlays = games.games.reduce((sum, g) => sum + (g.plays || 0), 0);
        
        res.json({ totalGames, publicGames, totalPlays, lastPublished: games.publishedAt });
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════╗
║     🟣 Tavian Studio API Server                       ║
╠═══════════════════════════════════════════════════════╣
║  📡 Running on: http://0.0.0.0:${PORT}                ║
║  ✅ CORS enabled                                      ║
║  📦 Games stored in: games.json                      ║
║  🎮 Game ID format: 9+ digit numbers                 ║
║  📥 Installer downloads: ${DOWNLOADS_DIR}            ║
╠═══════════════════════════════════════════════════════╣
║  📌 ENDPOINTS:                                        ║
║  POST   /api/games/publish  - Publish new game       ║
║  GET    /api/games          - List all public games  ║
║  GET    /api/games/:id      - Get specific game      ║
║  DELETE /api/games/:id      - Delete game            ║
║  GET    /api/stats          - Get statistics         ║
║  GET    /api/installer      - Get installer info     ║
║  GET    /download           - Download installer     ║
║  GET    /api/health         - Health check           ║
╚═══════════════════════════════════════════════════════╝
    `);
});
