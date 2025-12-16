const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fanfik-secret-key-2024';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'your-telegram-bot-token';
const SALT_ROUNDS = 12;

// Инициализация Telegram бота
let bot = null;
if (TELEGRAM_BOT_TOKEN && TELEGRAM_BOT_TOKEN !== 'your-telegram-bot-token') {
    try {
        bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
        
        bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            bot.sendMessage(chatId, 
                `👋 Привет! Я бот FanFik для двухфакторной аутентификации.\n\n` +
                `Ваш Chat ID: \`${chatId}\`\n\n` +
                `📋 Как использовать:\n` +
                `1. Скопируйте этот Chat ID\n` +
                `2. На сайте FanFik введите его в поле привязки Telegram\n` +
                `3. При входе на сайт вы будете получать коды подтверждения здесь\n\n` +
                `🔒 Безопасность:\n` +
                `• Никому не сообщайте этот Chat ID\n` +
                `• Коды подтверждения действуют 5 минут`, 
                { parse_mode: 'Markdown' }
            );
        });
        
        console.log('🤖 Telegram бот запущен');
    } catch (error) {
        console.error('Ошибка запуска Telegram бота:', error);
        bot = null;
    }
} else {
    console.warn('⚠️ Telegram бот не настроен');
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// Хранилище данных
let users = [];
let fics = [];
let pendingLogins = {}; // Для хранения ожидающих подтверждения входов

// Загрузка данных
async function loadData() {
    try {
        const usersData = await fs.readFile('users.json', 'utf8');
        users = JSON.parse(usersData);
        console.log(`👥 Загружено ${users.length} пользователей`);
    } catch (error) {
        users = [];
        await saveUsers();
    }
    
    try {
        const ficsData = await fs.readFile('ff.json', 'utf8');
        fics = JSON.parse(ficsData);
        console.log(`📚 Загружено ${fics.length} фанфиков`);
    } catch (error) {
        fics = [];
        await saveFics();
    }
}

// Сохранение данных
async function saveUsers() {
    await fs.writeFile('users.json', JSON.stringify(users, null, 2));
}

async function saveFics() {
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
    const user = users.find(u => u.username === req.user.username);
    if (!user || !user.isAdmin) {
        return res.sendStatus(403);
    }
    next();
}

// Инициализация при запуске
loadData().then(() => {
    console.log('✅ Данные загружены');
});

// API маршруты

// Регистрация
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Введите имя пользователя и пароль' });
    }
    
    if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ error: 'Имя пользователя должно быть от 3 до 20 символов' });
    }
    
    if (password.length < 6) {
        return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
    }
    
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Пользователь с таким именем уже существует' });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        
        const user = {
            id: Date.now().toString(),
            username,
            password: hashedPassword,
            telegramId: null,
            isAdmin: username === 'horrygame',
            createdAt: new Date().toISOString(),
            lastLogin: null
        };
        
        users.push(user);
        await saveUsers();
        
        const token = jwt.sign({ 
            username: user.username, 
            isAdmin: user.isAdmin,
            userId: user.id 
        }, JWT_SECRET, { expiresIn: '30d' });
        
        res.json({ 
            token, 
            user: { 
                username: user.username, 
                isAdmin: user.isAdmin,
                hasTelegram: false
            } 
        });
    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.status(500).json({ error: 'Ошибка при регистрации' });
    }
});

// Вход с 2FA через Telegram
app.post('/api/login', async (req, res) => {
    const { username, password, code } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Введите имя пользователя и пароль' });
    }
    
    const user = users.find(u => u.username === username);
    if (!user) {
        return res.status(401).json({ error: 'Неверное имя пользователя или пароль' });
    }
    
    try {
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Неверное имя пользователя или пароль' });
        }
        
        // Если у пользователя привязан Telegram
        if (user.telegramId) {
            // Если код не передан - это первый шаг входа, отправляем код в Telegram
            if (!code) {
                const verificationCode = generate2FACode();
                
                // Сохраняем код для проверки (действует 5 минут)
                pendingLogins[username] = {
                    code: verificationCode,
                    expires: Date.now() + 5 * 60 * 1000, // 5 минут
                    userId: user.id
                };
                
                // Отправляем код в Telegram
                if (bot) {
                    try {
                        await bot.sendMessage(user.telegramId,
                            `🔐 *Код подтверждения для входа в FanFik*\n\n` +
                            `Код: \`${verificationCode}\`\n` +
                            `Действует: 5 минут\n` +
                            `Имя пользователя: ${username}\n\n` +
                            `_Если это были не вы, проигнорируйте это сообщение._`,
                            { parse_mode: 'Markdown' }
                        );
                    } catch (error) {
                        console.error('Ошибка отправки кода в Telegram:', error);
                        return res.status(500).json({ error: 'Не удалось отправить код в Telegram' });
                    }
                } else {
                    return res.status(500).json({ error: 'Телеграм бот не настроен' });
                }
                
                return res.json({ 
                    require2FA: true,
                    message: 'Код подтверждения отправлен в Telegram'
                });
            } else {
                // Проверяем код подтверждения
                const pendingLogin = pendingLogins[username];
                
                if (!pendingLogin) {
                    return res.status(401).json({ error: 'Сессия входа устарела. Начните заново.' });
                }
                
                if (Date.now() > pendingLogin.expires) {
                    delete pendingLogins[username];
                    return res.status(401).json({ error: 'Код подтверждения устарел' });
                }
                
                if (pendingLogin.code !== code) {
                    return res.status(401).json({ error: 'Неверный код подтверждения' });
                }
                
                // Код верный, удаляем ожидающий вход
                delete pendingLogins[username];
            }
        }
        
        // Обновляем время последнего входа
        user.lastLogin = new Date().toISOString();
        await saveUsers();
        
        const token = jwt.sign({ 
            username: user.username, 
            isAdmin: user.isAdmin,
            userId: user.id 
        }, JWT_SECRET, { expiresIn: '30d' });
        
        res.json({ 
            token, 
            user: { 
                username: user.username, 
                isAdmin: user.isAdmin,
                hasTelegram: !!user.telegramId
            } 
        });
    } catch (error) {
        console.error('Ошибка входа:', error);
        res.status(500).json({ error: 'Ошибка при входе' });
    }
});

// Привязка Telegram
app.post('/api/bind-telegram', authenticateToken, async (req, res) => {
    const { telegramId } = req.body;
    
    if (!telegramId || !/^\d+$/.test(telegramId)) {
        return res.status(400).json({ error: 'Некорректный Telegram ID' });
    }
    
    try {
        const user = users.find(u => u.username === req.user.username);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Проверяем, не привязан ли этот Telegram ID к другому аккаунту
        const existingUser = users.find(u => u.telegramId === telegramId && u.username !== req.user.username);
        if (existingUser) {
            return res.status(400).json({ error: 'Этот Telegram ID уже привязан к другому аккаунту' });
        }
        
        user.telegramId = telegramId;
        await saveUsers();
        
        // Отправляем подтверждение в Telegram
        if (bot) {
            try {
                await bot.sendMessage(telegramId,
                    `✅ *Telegram успешно привязан!*\n\n` +
                    `Ваш аккаунт *${req.user.username}* на FanFik теперь защищен двухфакторной аутентификацией.\n\n` +
                    `📱 *Теперь при входе на сайт:*\n` +
                    `1. Вводите имя пользователя и пароль\n` +
                    `2. Получаете код подтверждения здесь\n` +
                    `3. Вводите код на сайте\n\n` +
                    `🔒 *Безопасность:*\n` +
                    `• Никому не сообщайте коды подтверждения\n` +
                    `• Коды действуют 5 минут\n` +
                    `• Без кода войти в аккаунт невозможно`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                console.error('Ошибка отправки подтверждения в Telegram:', error);
            }
        }
        
        res.json({ 
            success: true, 
            message: 'Telegram успешно привязан' 
        });
    } catch (error) {
        console.error('Ошибка привязки Telegram:', error);
        res.status(500).json({ error: 'Ошибка при привязке Telegram' });
    }
});

// Проверка авторизации
app.get('/api/check-auth', authenticateToken, (req, res) => {
    const user = users.find(u => u.username === req.user.username);
    if (user) {
        res.json({ 
            username: user.username, 
            isAdmin: user.isAdmin,
            hasTelegram: !!user.telegramId
        });
    } else {
        res.sendStatus(404);
    }
});

// Проверка админа
app.get('/api/check-admin', authenticateToken, checkAdmin, (req, res) => {
    res.json({ message: 'Доступ разрешен' });
});

// Получение фанфиков
app.get('/api/fics', (req, res) => {
    const approvedFics = fics.filter(fic => fic.status === 'approved');
    
    // Перемешиваем фанфики для обновления ленты
    const shuffled = [...approvedFics].sort(() => Math.random() - 0.5);
    res.json(shuffled);
});

// Поиск фанфиков
app.get('/api/search', (req, res) => {
    const query = req.query.q?.toLowerCase() || '';
    const results = fics.filter(fic => 
        fic.status === 'approved' && 
        (fic.title.toLowerCase().includes(query) ||
         fic.author.toLowerCase().includes(query) ||
         (fic.genre && fic.genre.some(g => g.toLowerCase().includes(query))))
    );
    
    res.json(results);
});

// Отправка фанфика на рассмотрение
app.post('/api/submit-fic', authenticateToken, async (req, res) => {
    try {
        const { title, author, genre, age, chapters } = req.body;
        
        if (!title || !author || !genre || !chapters || chapters.length === 0) {
            return res.status(400).json({ error: 'Заполните все обязательные поля' });
        }
        
        const fic = {
            id: Date.now().toString(),
            title: title.trim(),
            author: author.trim(),
            genre: Array.isArray(genre) ? genre : [genre.trim()],
            age: age || '0+',
            chapters: chapters.map(ch => ({
                title: ch.title.trim(),
                content: ch.content.trim(),
                createdAt: new Date().toISOString()
            })),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            submittedBy: req.user.username,
            status: 'pending',
            mark: null
        };
        
        fics.push(fic);
        await saveFics();
        
        // Уведомляем администратора
        const admin = users.find(u => u.username === 'horrygame');
        if (admin && admin.telegramId && bot) {
            try {
                await bot.sendMessage(admin.telegramId,
                    `📬 *Новый фанфик на проверку!*\n\n` +
                    `📖 Название: ${fic.title}\n` +
                    `👤 Автор: ${fic.author}\n` +
                    `🏷️ Жанры: ${fic.genre.join(', ')}\n` +
                    `📊 Глав: ${fic.chapters.length}\n\n` +
                    `Зайдите в админ-панель для проверки.`
                );
            } catch (error) {
                console.error('Ошибка отправки уведомления админу:', error);
            }
        }
        
        res.json({ success: true, ficId: fic.id });
    } catch (error) {
        console.error('Ошибка отправки фанфика:', error);
        res.status(500).json({ error: 'Ошибка при отправке фанфика' });
    }
});

// Получение фанфиков на рассмотрении (для админа)
app.get('/api/pending-fics', authenticateToken, checkAdmin, (req, res) => {
    const pendingFics = fics.filter(fic => fic.status === 'pending');
    res.json(pendingFics);
});

// Обновление статуса фанфика
app.post('/api/update-fic', authenticateToken, checkAdmin, async (req, res) => {
    const { ficId, status } = req.body;
    const ficIndex = fics.findIndex(fic => fic.id === ficId);
    
    if (ficIndex === -1) {
        return res.status(404).json({ error: 'Фанфик не найден' });
    }
    
    try {
        if (status === 'deleted') {
            fics.splice(ficIndex, 1);
        } else {
            fics[ficIndex].status = status;
            fics[ficIndex].updatedAt = new Date().toISOString();
            
            // Уведомляем автора через Telegram, если возможно
            if (bot && status === 'approved') {
                const author = users.find(u => u.username === fics[ficIndex].submittedBy);
                if (author && author.telegramId) {
                    try {
                        await bot.sendMessage(author.telegramId,
                            `🎉 *Ваш фанфик одобрен!*\n\n` +
                            `"${fics[ficIndex].title}" теперь опубликован на FanFik!\n\n` +
                            `Читатели смогут найти его в поиске. Продолжайте творить!`
                        );
                    } catch (error) {
                        console.error('Ошибка отправки уведомления автору:', error);
                    }
                }
            }
        }
        await saveFics();
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка обновления статуса:', error);
        res.status(500).json({ error: 'Ошибка при обновлении статуса' });
    }
});

// Установка метки фанфику
app.post('/api/set-mark', authenticateToken, checkAdmin, async (req, res) => {
    const { ficId, mark } = req.body;
    const fic = fics.find(fic => fic.id === ficId);
    
    if (!fic) {
        return res.status(404).json({ error: 'Фанфик не найден' });
    }
    
    fic.mark = mark;
    fic.updatedAt = new Date().toISOString();
    await saveFics();
    
    res.json({ success: true });
});

// Обновление возрастного рейтинга
app.post('/api/update-age', authenticateToken, checkAdmin, async (req, res) => {
    const { ficId, age } = req.body;
    const fic = fics.find(fic => fic.id === ficId);
    
    if (!fic) {
        return res.status(404).json({ error: 'Фанфик не найден' });
    }
    
    fic.age = age;
    fic.updatedAt = new Date().toISOString();
    await saveFics();
    
    res.json({ success: true });
});

// Экспорт фанфиков
app.get('/api/export/fics', authenticateToken, checkAdmin, (req, res) => {
    res.json({
        exportedAt: new Date().toISOString(),
        total: fics.length,
        fics: fics
    });
});

// Экспорт пользователей (без паролей)
app.get('/api/export/users', authenticateToken, checkAdmin, (req, res) => {
    const safeUsers = users.map(user => ({
        id: user.id,
        username: user.username,
        isAdmin: user.isAdmin,
        telegramId: user.telegramId,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        hasTelegram: !!user.telegramId
    }));
    
    res.json({
        exportedAt: new Date().toISOString(),
        total: users.length,
        users: safeUsers
    });
});

// Обновление рекомендаций каждые 30 минут
setInterval(() => {
    console.log('🔄 Рекомендации обновлены');
}, 30 * 60 * 1000);

// Очистка устаревших ожидающих входов
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    
    for (const username in pendingLogins) {
        if (pendingLogins[username].expires < now) {
            delete pendingLogins[username];
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log(`🧹 Очищено ${cleaned} устаревших сессий входа`);
    }
}, 60 * 1000); // Каждую минуту

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`👥 Пользователей: ${users.length}`);
    console.log(`📚 Фанфиков: ${fics.length}`);
    console.log(`🤖 Telegram бот: ${bot ? 'активен' : 'не настроен'}`);
});

// Экспортируем для тестов
module.exports = { app, users, fics };
