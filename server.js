const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');

const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'nope-game-platform-secret-key-2024';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'nope2024';

app.use(cors());
app.use(express.json());

let pool = null;
let dbReady = false;

async function initDatabase() {
    if (!process.env.DATABASE_URL) {
        console.log('⚠️ DATABASE_URL not set, using in-memory storage');
        return false;
    }
    
    try {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        
        const client = await pool.connect();
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(36) PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                email VARCHAR(100),
                isAdmin BOOLEAN DEFAULT FALSE,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS games (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                description TEXT,
                intro TEXT,
                url VARCHAR(500) NOT NULL,
                icon VARCHAR(10) DEFAULT '🎮',
                cover TEXT,
                tags TEXT,
                author VARCHAR(50) NOT NULL,
                authorId VARCHAR(36) NOT NULL,
                isAdminGame BOOLEAN DEFAULT FALSE,
                plays INTEGER DEFAULT 0,
                version INTEGER DEFAULT 1,
                status VARCHAR(20) DEFAULT 'approved',
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updatedAt TIMESTAMP
            )
        `);
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS comments (
                id VARCHAR(36) PRIMARY KEY,
                gameId VARCHAR(36) NOT NULL,
                userId VARCHAR(36) NOT NULL,
                username VARCHAR(50) NOT NULL,
                content TEXT NOT NULL,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS follows (
                id VARCHAR(36) PRIMARY KEY,
                followerId VARCHAR(36) NOT NULL,
                followerName VARCHAR(50),
                followingId VARCHAR(36) NOT NULL,
                followingName VARCHAR(50),
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id VARCHAR(36) PRIMARY KEY,
                fromId VARCHAR(36) NOT NULL,
                fromName VARCHAR(50) NOT NULL,
                toId VARCHAR(36) NOT NULL,
                toName VARCHAR(50) NOT NULL,
                content TEXT NOT NULL,
                read BOOLEAN DEFAULT FALSE,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS activities (
                id VARCHAR(36) PRIMARY KEY,
                userId VARCHAR(36) NOT NULL,
                type VARCHAR(20) NOT NULL,
                content TEXT NOT NULL,
                read BOOLEAN DEFAULT FALSE,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        const adminExists = await client.query("SELECT * FROM users WHERE username = 'admin'");
        if (adminExists.rows.length === 0) {
            const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
            await client.query("INSERT INTO users (id, username, password, email, isAdmin) VALUES ('admin', 'admin', $1, 'admin@nope.com', true)", [hashedPassword]);
            console.log('✅ 管理员账户已创建');
        }
        
        const gameExists = await client.query("SELECT * FROM games WHERE id = 'default-1'");
        if (gameExists.rows.length === 0) {
            await client.query(`INSERT INTO games (id, name, description, url, icon, tags, author, authorId, isAdminGame, status) 
                VALUES ('default-1', '海底耗子', '在神秘的海底世界中，控制你的小鱼不断成长，躲避更大的鱼，成为海洋霸主！', 'fish_game_simple.html', '🐟', '休闲,冒险,HTML5', '管理员', 'admin', true, 'approved')`);
            console.log('✅ 默认游戏已创建');
        }
        
        client.release();
        console.log('✅ 数据库初始化完成');
        return true;
    } catch (error) {
        console.error('❌ 数据库初始化失败:', error.message);
        return false;
    }
}

const memoryDB = {
    users: [],
    games: [{
        id: 'default-1',
        name: '海底耗子',
        description: '在神秘的海底世界中，控制你的小鱼不断成长，躲避更大的鱼，成为海洋霸主！',
        url: 'fish_game_simple.html',
        icon: '🐟',
        tags: '休闲,冒险,HTML5',
        author: '管理员',
        authorid: 'admin',
        isadmingame: true,
        plays: 0,
        status: 'approved',
        createdat: new Date().toISOString()
    }],
    comments: [],
    follows: [],
    messages: [],
    activities: []
};

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: '需要登录' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: '无效的token' });
        }
        req.user = user;
        next();
    });
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', db: dbReady ? 'connected' : 'disconnected' });
});

app.post('/api/register', async (req, res) => {
    try {
        const { username, password, email } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: '用户名和密码不能为空' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ error: '密码至少6个字符' });
        }
        
        const hasLetter = /[a-zA-Z]/.test(password);
        const hasNumber = /[0-9]/.test(password);
        if (!hasLetter || !hasNumber) {
            return res.status(400).json({ error: '密码必须包含字母和数字' });
        }
        
        if (dbReady && pool) {
            const existing = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
            if (existing.rows.length > 0) {
                return res.status(400).json({ error: '用户名已存在' });
            }
            
            const hashedPassword = await bcrypt.hash(password, 10);
            const userId = uuidv4();
            
            await pool.query('INSERT INTO users (id, username, password, email) VALUES ($1, $2, $3, $4)', [userId, username, hashedPassword, email || '']);
        } else {
            if (memoryDB.users.find(u => u.username === username)) {
                return res.status(400).json({ error: '用户名已存在' });
            }
            const hashedPassword = await bcrypt.hash(password, 10);
            memoryDB.users.push({
                id: uuidv4(),
                username,
                password: hashedPassword,
                email: email || '',
                isadmin: false
            });
        }
        
        res.json({ success: true, message: '注册成功' });
    } catch (error) {
        res.status(500).json({ error: '注册失败: ' + error.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        let user = null;
        
        if (dbReady && pool) {
            const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
            user = result.rows[0];
        } else {
            user = memoryDB.users.find(u => u.username === username);
        }
        
        if (!user) {
            return res.status(400).json({ error: '用户名或密码错误' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: '用户名或密码错误' });
        }
        
        const token = jwt.sign(
            { id: user.id, username: user.username, isAdmin: user.isadmin },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                isAdmin: user.isadmin
            }
        });
    } catch (error) {
        res.status(500).json({ error: '登录失败' });
    }
});

app.get('/api/games', async (req, res) => {
    try {
        let games = [];
        
        if (dbReady && pool) {
            const result = await pool.query("SELECT * FROM games WHERE status = 'approved' ORDER BY createdAt DESC");
            games = result.rows.map(game => ({
                ...game,
                tags: game.tags ? game.tags.split(',') : []
            }));
        } else {
            games = memoryDB.games.filter(g => g.status === 'approved').map(game => ({
                ...game,
                tags: game.tags ? game.tags.split(',') : []
            }));
        }
        
        res.json(games);
    } catch (error) {
        res.status(500).json({ error: '获取游戏失败' });
    }
});

app.get('/api/pending-games', authenticateToken, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ error: '需要管理员权限' });
        }
        
        let games = [];
        
        if (dbReady && pool) {
            const result = await pool.query("SELECT * FROM games WHERE status = 'pending' ORDER BY createdAt DESC");
            games = result.rows.map(game => ({
                ...game,
                tags: game.tags ? game.tags.split(',') : []
            }));
        } else {
            games = memoryDB.games.filter(g => g.status === 'pending').map(game => ({
                ...game,
                tags: game.tags ? game.tags.split(',') : []
            }));
        }
        
        res.json(games);
    } catch (error) {
        res.status(500).json({ error: '获取待审核游戏失败' });
    }
});

app.post('/api/games/:id/approve', authenticateToken, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ error: '需要管理员权限' });
        }
        
        if (dbReady && pool) {
            await pool.query("UPDATE games SET status = 'approved' WHERE id = $1", [req.params.id]);
        } else {
            const game = memoryDB.games.find(g => g.id === req.params.id);
            if (game) game.status = 'approved';
        }
        
        res.json({ success: true, message: '游戏已审核通过' });
    } catch (error) {
        res.status(500).json({ error: '审核失败' });
    }
});

app.post('/api/games/:id/reject', authenticateToken, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ error: '需要管理员权限' });
        }
        
        if (dbReady && pool) {
            await pool.query("DELETE FROM games WHERE id = $1", [req.params.id]);
        } else {
            memoryDB.games = memoryDB.games.filter(g => g.id !== req.params.id);
        }
        
        res.json({ success: true, message: '游戏已拒绝' });
    } catch (error) {
        res.status(500).json({ error: '操作失败' });
    }
});

app.post('/api/games', authenticateToken, async (req, res) => {
    try {
        const { name, description, intro, url, icon, tags } = req.body;
        
        if (!name || !url) {
            return res.status(400).json({ error: '游戏名称和链接不能为空' });
        }
        
        const gameId = uuidv4();
        const status = req.user.isAdmin ? 'approved' : 'pending';
        
        if (dbReady && pool) {
            await pool.query(
                'INSERT INTO games (id, name, description, intro, url, icon, tags, author, authorId, isAdminGame, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
                [gameId, name, description || '', intro || '', url, icon || '🎮', tags || '游戏', req.user.username, req.user.id, req.user.isAdmin, status]
            );
        } else {
            memoryDB.games.push({
                id: gameId,
                name,
                description: description || '',
                intro: intro || '',
                url,
                icon: icon || '🎮',
                tags: tags || '游戏',
                author: req.user.username,
                authorid: req.user.id,
                isadmingame: req.user.isAdmin,
                plays: 0,
                status,
                createdat: new Date().toISOString()
            });
        }
        
        res.json({ 
            success: true, 
            message: req.user.isAdmin ? '游戏上传成功！' : '游戏已提交，等待审核',
            gameId 
        });
    } catch (error) {
        res.status(500).json({ error: '上传失败: ' + error.message });
    }
});

app.post('/api/games/:id/play', async (req, res) => {
    try {
        if (dbReady && pool) {
            await pool.query('UPDATE games SET plays = plays + 1 WHERE id = $1', [req.params.id]);
        } else {
            const game = memoryDB.games.find(g => g.id === req.params.id);
            if (game) game.plays = (game.plays || 0) + 1;
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: '操作失败' });
    }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, async () => {
    console.log(`🚀 NOPE游戏平台服务器运行在端口 ${PORT}`);
    dbReady = await initDatabase();
    if (!dbReady) {
        console.log('⚠️ 使用内存存储模式，数据不会持久化');
        const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
        memoryDB.users.push({
            id: 'admin',
            username: 'admin',
            password: hashedPassword,
            email: 'admin@nope.com',
            isadmin: true
        });
    }
});
