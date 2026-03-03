require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

function loadDataFromFile() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            console.log('✅ 从文件加载数据成功');
            return data;
        }
    } catch (error) {
        console.error('⚠️ 加载数据文件失败，使用默认数据:', error.message);
    }
    return null;
}

function saveDataToFile(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        console.log('💾 数据已保存到文件');
    } catch (error) {
        console.error('❌ 保存数据文件失败:', error.message);
    }
}

function saveMemoryDB() {
    if (!dbReady) {
        saveDataToFile(memoryDB);
    }
}

const initialData = {
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
        createdat: new Date().toISOString(),
        comments: []
    }],
    comments: [],
    follows: [],
    messages: [],
    activities: []
};

const loadedData = loadDataFromFile();
let memoryDB = loadedData || initialData;

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'nope-game-platform-secret-key-2024';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'nope2026';

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
        } else {
            const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
            await client.query("UPDATE users SET password = $1 WHERE username = 'admin'", [hashedPassword]);
            console.log('✅ 管理员密码已更新');
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

app.get('/api/debug/admin', async (req, res) => {
    try {
        if (dbReady && pool) {
            const result = await pool.query("SELECT id, username, email, isadmin, \"isAdmin\" FROM users WHERE username = 'admin'");
            res.json({ adminExists: result.rows.length > 0, admin: result.rows[0] });
        } else {
            const admin = memoryDB.users.find(u => u.username === 'admin');
            res.json({ adminExists: !!admin, admin });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/users', authenticateToken, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ error: '需要管理员权限' });
        }
        
        let users = [];
        
        if (dbReady && pool) {
            const result = await pool.query('SELECT id, username, email, isAdmin, createdAt FROM users ORDER BY createdAt DESC');
            users = result.rows;
        } else {
            users = memoryDB.users.map(u => ({
                id: u.id,
                username: u.username,
                email: u.email,
                isAdmin: u.isAdmin,
                createdAt: u.createdAt
            }));
        }
        
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: '获取用户列表失败' });
    }
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
            saveMemoryDB();
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
            { id: user.id, username: user.username, isAdmin: user.isadmin || user.isAdmin },
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
                isAdmin: user.isadmin || user.isAdmin
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
                'INSERT INTO games (id, name, description, intro, url, icon, cover, tags, author, authorId, isAdminGame, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
                [gameId, name, description || '', intro || '', url, '🎮', req.body.cover || '', tags || '游戏', req.user.username, req.user.id, req.user.isAdmin, status]
            );
        } else {
            memoryDB.games.push({
                id: gameId,
                name,
                description: description || '',
                intro: intro || '',
                url,
                icon: '🎮',
                cover: req.body.cover || '',
                tags: tags || '游戏',
                author: req.user.username,
                authorid: req.user.id,
                isadmingame: req.user.isAdmin,
                plays: 0,
                status,
                createdat: new Date().toISOString(),
                comments: []
            });
            saveMemoryDB();
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
            saveMemoryDB();
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: '操作失败' });
    }
});

// 关注API
app.get('/api/follows', async (req, res) => {
    try {
        if (dbReady && pool) {
            const result = await pool.query('SELECT * FROM follows ORDER BY createdAt DESC');
            res.json(result.rows);
        } else {
            res.json(memoryDB.follows || []);
        }
    } catch (error) {
        res.status(500).json({ error: '获取关注列表失败' });
    }
});

app.post('/api/follows', authenticateToken, async (req, res) => {
    try {
        const { followingId, followingName } = req.body;
        const followId = uuidv4();
        
        if (dbReady && pool) {
            const existing = await pool.query(
                'SELECT * FROM follows WHERE followerId = $1 AND followingId = $2',
                [req.user.id, followingId]
            );
            if (existing.rows.length > 0) {
                await pool.query('DELETE FROM follows WHERE followerId = $1 AND followingId = $2', [req.user.id, followingId]);
                res.json({ success: true, action: 'unfollowed' });
            } else {
                await pool.query(
                    'INSERT INTO follows (id, followerId, followerName, followingId, followingName) VALUES ($1, $2, $3, $4, $5)',
                    [followId, req.user.id, req.user.username, followingId, followingName]
                );
                res.json({ success: true, action: 'followed' });
            }
        } else {
            if (!memoryDB.follows) memoryDB.follows = [];
            const existingIndex = memoryDB.follows.findIndex(
                f => f.followerid === req.user.id && f.followingid === followingId
            );
            if (existingIndex > -1) {
                memoryDB.follows.splice(existingIndex, 1);
                saveMemoryDB();
                res.json({ success: true, action: 'unfollowed' });
            } else {
                memoryDB.follows.push({
                    id: followId,
                    followerid: req.user.id,
                    followername: req.user.username,
                    followingid: followingId,
                    followingname: followingName,
                    createdat: new Date().toISOString()
                });
                saveMemoryDB();
                res.json({ success: true, action: 'followed' });
            }
        }
    } catch (error) {
        res.status(500).json({ error: '操作失败' });
    }
});

// 评论API
app.get('/api/games/:id/comments', async (req, res) => {
    try {
        if (dbReady && pool) {
            const result = await pool.query(
                'SELECT * FROM comments WHERE gameId = $1 ORDER BY createdAt DESC',
                [req.params.id]
            );
            res.json(result.rows);
        } else {
            const game = memoryDB.games.find(g => g.id === req.params.id);
            res.json(game?.comments || []);
        }
    } catch (error) {
        res.status(500).json({ error: '获取评论失败' });
    }
});

app.post('/api/games/:id/comments', authenticateToken, async (req, res) => {
    try {
        const { content } = req.body;
        const commentId = uuidv4();
        
        if (dbReady && pool) {
            await pool.query(
                'INSERT INTO comments (id, gameId, userId, username, content) VALUES ($1, $2, $3, $4, $5)',
                [commentId, req.params.id, req.user.id, req.user.username, content]
            );
        } else {
            const game = memoryDB.games.find(g => g.id === req.params.id);
            if (game) {
                if (!game.comments) game.comments = [];
                game.comments.push({
                    id: commentId,
                    gameid: req.params.id,
                    userid: req.user.id,
                    username: req.user.username,
                    content,
                    createdat: new Date().toISOString()
                });
                saveMemoryDB();
            }
        }
        res.json({ success: true, commentId });
    } catch (error) {
        res.status(500).json({ error: '评论失败' });
    }
});

// 消息API
app.get('/api/messages', authenticateToken, async (req, res) => {
    try {
        if (dbReady && pool) {
            const result = await pool.query(
                'SELECT * FROM messages WHERE toId = $1 OR fromId = $1 ORDER BY createdAt DESC',
                [req.user.id]
            );
            res.json(result.rows);
        } else {
            const messages = (memoryDB.messages || []).filter(
                m => m.toid === req.user.id || m.fromid === req.user.id
            );
            res.json(messages);
        }
    } catch (error) {
        res.status(500).json({ error: '获取消息失败' });
    }
});

app.post('/api/messages', authenticateToken, async (req, res) => {
    try {
        const { toId, toName, content } = req.body;
        const messageId = uuidv4();
        
        if (dbReady && pool) {
            await pool.query(
                'INSERT INTO messages (id, fromId, fromName, toId, toName, content) VALUES ($1, $2, $3, $4, $5, $6)',
                [messageId, req.user.id, req.user.username, toId, toName, content]
            );
        } else {
            if (!memoryDB.messages) memoryDB.messages = [];
            memoryDB.messages.push({
                id: messageId,
                fromid: req.user.id,
                fromname: req.user.username,
                toid: toId,
                toname: toName,
                content,
                read: false,
                createdat: new Date().toISOString()
            });
        }
        res.json({ success: true, messageId });
    } catch (error) {
        res.status(500).json({ error: '发送失败' });
    }
});

app.post('/api/messages/:id/read', authenticateToken, async (req, res) => {
    try {
        if (dbReady && pool) {
            await pool.query('UPDATE messages SET read = true WHERE id = $1', [req.params.id]);
        } else {
            const msg = memoryDB.messages?.find(m => m.id === req.params.id);
            if (msg) msg.read = true;
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: '操作失败' });
    }
});

// 活动API
app.get('/api/activities', authenticateToken, async (req, res) => {
    try {
        if (dbReady && pool) {
            const result = await pool.query(
                'SELECT * FROM activities WHERE userId = $1 ORDER BY createdAt DESC LIMIT 50',
                [req.user.id]
            );
            res.json(result.rows);
        } else {
            const activities = (memoryDB.activities || []).filter(a => a.userid === req.user.id);
            res.json(activities);
        }
    } catch (error) {
        res.status(500).json({ error: '获取活动失败' });
    }
});

app.post('/api/activities', authenticateToken, async (req, res) => {
    try {
        const { userId, type, content } = req.body;
        const activityId = uuidv4();
        
        if (dbReady && pool) {
            await pool.query(
                'INSERT INTO activities (id, userId, type, content) VALUES ($1, $2, $3, $4)',
                [activityId, userId, type, content]
            );
        } else {
            if (!memoryDB.activities) memoryDB.activities = [];
            memoryDB.activities.push({
                id: activityId,
                userid: userId,
                type,
                content,
                createdat: new Date().toISOString()
            });
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
        console.log('⚠️ 使用文件存储模式，数据将保存到 data.json');
        const adminExists = memoryDB.users.find(u => u.username === 'admin');
        if (!adminExists) {
            const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
            memoryDB.users.push({
                id: 'admin',
                username: 'admin',
                password: hashedPassword,
                email: 'admin@nope.com',
                isadmin: true
            });
            saveMemoryDB();
        }
    }
});
