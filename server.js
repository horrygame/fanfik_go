const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-here';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'your-telegram-bot-token';

// Инициализация Telegram бота
const bot = TELEGRAM_BOT_TOKEN !== 'your-telegram-bot-token' ? 
    new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true }) : null;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Хранилище данных
let users = [];
let fics = [];
let twoFACodes = {};

// Загрузка данных
async function loadData() {
    try {
        const usersData = await fs.readFile('users.json', 'utf8');
        users = JSON.parse(usersData);
    } catch (error) {
        users = [];
    }
    
    try {
        const ficsData = await fs.readFile('ff.json', 'utf8');
        fics = JSON.parse(ficsData);
    } catch (error) {
        fics = [];
    }
}

// Сохранение данных
async function saveData() {
    await fs.writeFile('users.json', JSON.stringify(users, null, 2));
    await fs.writeFile('ff.json', JSON.stringify(fics, null, 2));
}

// Генерация 2FA кода
function generate2FACode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Middleware для проверки JWT
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.sendStatus(401);
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

// Проверка админских прав
function checkAdmin(req, res, next) {
    if (req.user.username !== 'horrygame') {
        return res.sendStatus(403);
    }
    next();
}

// Инициализация при запуске
loadData();

// API маршруты

// Регистрация
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Пользователь уже существует' });
    }
    
    const user = {
        id: Date.now().toString(),
        username,
        password, // В реальном приложении хэшируйте пароль!
        isAdmin: username === 'horrygame',
        createdAt: new Date().toISOString()
    };
    
    users.push(user);
    await saveData();
    
    const token = jwt.sign({ username: user.username, isAdmin: user.isAdmin }, JWT_SECRET);
    res.json({ token, user: { username: user.username, isAdmin: user.isAdmin } });
});

// Вход
app.post('/api/login', async (req, res) => {
    const { username, password, telegramId } = req.body;
    
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) {
        return res.status(401).json({ error: 'Неверные данные' });
    }
    
    // Если указан telegramId, отправляем 2FA код
    if (telegramId && bot) {
        const code = generate2FACode();
        twoFACodes[username] = { code, telegramId };
        
        try {
            await bot.sendMessage(telegramId, `Ваш код подтверждения: ${code}`);
            return res.json({ require2FA: true });
        } catch (error) {
            return res.status(500).json({ error: 'Ошибка отправки 2FA кода' });
        }
    }
    
    // Если код 2FA предоставлен
    if (twoFACodes[username] && telegramId) {
        const twoFA = twoFACodes[username];
        if (twoFA.code === telegramId) {
            delete twoFACodes[username];
            const token = jwt.sign({ username: user.username, isAdmin: user.isAdmin }, JWT_SECRET);
            return res.json({ token, user: { username: user.username, isAdmin: user.isAdmin } });
        } else {
            return res.status(401).json({ error: 'Неверный код 2FA' });
        }
    }
    
    // Без 2FA
    const token = jwt.sign({ username: user.username, isAdmin: user.isAdmin }, JWT_SECRET);
    res.json({ token, user: { username: user.username, isAdmin: user.isAdmin } });
});

// Проверка авторизации
app.get('/api/check-auth', authenticateToken, (req, res) => {
    res.json({ username: req.user.username, isAdmin: req.user.isAdmin });
});

// Проверка админа
app.get('/api/check-admin', authenticateToken, checkAdmin, (req, res) => {
    res.json({ message: 'Admin access granted' });
});

// Получение фанфиков
app.get('/api/fics', (req, res) => {
    const approvedFics = fics.filter(fic => fic.status === 'approved');
    
    // Перемешиваем фанфики для "обновления рекомендаций"
    const shuffled = [...approvedFics].sort(() => Math.random() - 0.5);
    res.json(shuffled);
});

// Поиск фанфиков
app.get('/api/search', (req, res) => {
    const query = req.query.q?.toLowerCase() || '';
    const results = fics.filter(fic => 
        fic.status === 'approved' && 
        fic.title.toLowerCase().includes(query)
    );
    res.json(results);
});

// Отправка фанфика на рассмотрение
app.post('/api/submit-fic', authenticateToken, async (req, res) => {
    const fic = {
        id: Date.now().toString(),
        ...req.body,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        submittedBy: req.user.username,
        status: 'pending',
        mark: null
    };
    
    fics.push(fic);
    await saveData();
    res.json({ success: true, ficId: fic.id });
});

// Получение фанфиков на рассмотрении
app.get('/api/pending-fics', authenticateToken, checkAdmin, (req, res) => {
    const pendingFics = fics.filter(fic => fic.status === 'pending');
    res.json(pendingFics);
});

// Обновление статуса фанфика
app.post('/api/update-fic', authenticateToken, checkAdmin, async (req, res) => {
    const { ficId, status } = req.body;
    const ficIndex = fics.findIndex(fic => fic.id === ficId);
    
    if (ficIndex !== -1) {
        if (status === 'deleted') {
            fics.splice(ficIndex, 1);
        } else {
            fics[ficIndex].status = status;
            fics[ficIndex].updatedAt = new Date().toISOString();
        }
        await saveData();
    }
    
    res.json({ success: true });
});

// Установка метки фанфику
app.post('/api/set-mark', authenticateToken, checkAdmin, async (req, res) => {
    const { ficId, mark } = req.body;
    const fic = fics.find(fic => fic.id === ficId);
    
    if (fic) {
        fic.mark = mark;
        await saveData();
    }
    
    res.json({ success: true });
});

// Обновление возрастного рейтинга
app.post('/api/update-age', authenticateToken, checkAdmin, async (req, res) => {
    const { ficId, age } = req.body;
    const fic = fics.find(fic => fic.id === ficId);
    
    if (fic) {
        fic.age = age;
        await saveData();
    }
    
    res.json({ success: true });
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Функция для поддержания активности сервера (для Render)
setInterval(() => {
    console.log('Keep-alive ping');
}, 5 * 60 * 1000); // Каждые 5 минут

// Обновление рекомендаций каждые 30 минут
setInterval(() => {
    console.log('Recommendations updated');
}, 30 * 60 * 1000);
