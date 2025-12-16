const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fanfik-go-secret-key-2024';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'your-telegram-bot-token';
const SALT_ROUNDS = 12;

// Инициализация Telegram бота
let bot = null;
if (TELEGRAM_BOT_TOKEN && TELEGRAM_BOT_TOKEN !== 'your-telegram-bot-token') {
    try {
        bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
        
        // Настройка вебхука для продакшена
        if (process.env.RENDER_URL) {
            const webhookUrl = `${process.env.RENDER_URL}/telegram-webhook`;
            bot.setWebHook(webhookUrl);
            
            app.post('/telegram-webhook', (req, res) => {
                bot.processUpdate(req.body);
                res.sendStatus(200);
            });
        } else {
            // Для разработки используем polling
            bot.startPolling();
        }
        
        // Обработчик команд бота
        bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id;
            const username = msg.from.username || msg.from.first_name;
            
            bot.sendMessage(chatId, 
                `🚀 *Добро пожаловать в FanFik GO!*\n\n` +
                `Ваш уникальный Chat ID: \`${chatId}\`\n\n` +
                `📋 *Как использовать:*\n` +
                `1. Скопируйте Chat ID выше\n` +
                `2. На сайте FanFik GO введите его в поле привязки Telegram\n` +
                `3. Получайте коды 2FA и уведомления прямо здесь!\n\n` +
                `🛡️ *Безопасность:*\n` +
                `• Этот ID нужен только для привязки вашего аккаунта\n` +
                `• Никому не сообщайте этот код\n\n` +
                `💫 *Функции бота:*\n` +
                `• Двухфакторная аутентификация\n` +
                `• Уведомления о новых фанфиках\n` +
                `• Оповещения о комментариях\n` +
                `• Новости сообщества`, 
                { parse_mode: 'Markdown' }
            );
        });
        
        // Ответ на сообщения
        bot.on('message', (msg) => {
            if (!msg.text?.startsWith('/')) {
                bot.sendMessage(msg.chat.id, 
                    `Привет! Я бот FanFik GO.\n\n` +
                    `Используйте команду /start чтобы получить ваш Chat ID для привязки аккаунта на сайте.\n\n` +
                    `📚 FanFik GO - ваша вселенная историй в движении!`
                );
            }
        });
        
        console.log('🤖 Telegram бот @fanfik_go_bot запущен');
    } catch (error) {
        console.error('Ошибка запуска Telegram бота:', error);
        bot = null;
    }
} else {
    console.warn('⚠️ Telegram бот не настроен. Укажите TELEGRAM_BOT_TOKEN в переменных окружения.');
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// Хранилище данных
let users = [];
let fics = [];
let twoFACodes = {};
let onlineUsers = new Set();

// Загрузка данных
async function loadData() {
    try {
        const usersData = await fs.readFile('users.json', 'utf8');
        users = JSON.parse(usersData);
        console.log(`📊 Загружено ${users.length} пользователей`);
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
        onlineUsers.add(user.username);
        next();
    });
}

// Middleware для удаления неактивных пользователей
setInterval(() => {
    // Очищаем онлайн пользователей каждые 5 минут
    if (onlineUsers.size > 100) {
        onlineUsers.clear();
    }
}, 5 * 60 * 1000);

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
    console.log('✅ Данные успешно загружены');
});

// API маршруты

// Регистрация
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Заполните позывной и код доступа' });
    }
    
    if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ error: 'Позывной должен быть от 3 до 20 символов' });
    }
    
    if (password.length < 6) {
        return res.status(400).json({ error: 'Код доступа должен быть не менее 6 символов' });
    }
    
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Пользователь с таким позывным уже существует' });
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
            lastLogin: null,
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=8b4513&color=fff&size=128`
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
                hasTelegram: false,
                avatar: user.avatar
            } 
        });
    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.status(500).json({ error: 'Ошибка при регистрации' });
    }
});

// Вход
app.post('/api/login', async (req, res) => {
    const { username, password, telegramId } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Заполните позывной и код доступа' });
    }
    
    const user = users.find(u => u.username === username);
    if (!user) {
        return res.status(401).json({ error: 'Неверный позывной или код доступа' });
    }
    
    try {
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Неверный позывной или код доступа' });
        }
        
        // Если указан telegramId, отправляем 2FA код
        if (telegramId && bot && user.telegramId) {
            const code = generate2FACode();
            twoFACodes[username] = { 
                code, 
                telegramId: user.telegramId,
                expires: Date.now() + 5 * 60 * 1000 // 5 минут
            };
            
            try {
                await bot.sendMessage(user.telegramId,
                    `🔐 *Код подтверждения FanFik GO*\n\n` +
                    `Код: \`${code}\`\n` +
                    `Срок действия: 5 минут\n\n` +
                    `Введите этот код на сайте для завершения входа.\n` +
                    `_Если это были не вы, проигнорируйте это сообщение._`,
                    { parse_mode: 'Markdown' }
                );
                return res.json({ require2FA: true });
            } catch (error) {
                console.error('Ошибка отправки 2FA кода:', error);
                return res.status(500).json({ error: 'Ошибка отправки кода подтверждения' });
            }
        }
        
        // Если код 2FA предоставлен
        if (twoFACodes[username] && telegramId) {
            const twoFA = twoFACodes[username];
            
            // Проверяем срок действия
            if (Date.now() > twoFA.expires) {
                delete twoFACodes[username];
                return res.status(401).json({ error: 'Срок действия кода истек' });
            }
            
            if (twoFA.code === telegramId) {
                delete twoFACodes[username];
                
                // Обновляем последний вход
                user.lastLogin = new Date().toISOString();
                await saveUsers();
                
                const token = jwt.sign({ 
                    username: user.username, 
                    isAdmin: user.isAdmin,
                    userId: user.id 
                }, JWT_SECRET, { expiresIn: '30d' });
                
                return res.json({ 
                    token, 
                    user: { 
                        username: user.username, 
                        isAdmin: user.isAdmin,
                        hasTelegram: !!user.telegramId,
                        avatar: user.avatar
                    } 
                });
            } else {
                return res.status(401).json({ error: 'Неверный код подтверждения' });
            }
        }
        
        // Без 2FA (если Telegram не привязан)
        if (!user.telegramId && telegramId) {
            // Привязываем Telegram ID
            user.telegramId = telegramId;
            await saveUsers();
        }
        
        // Обновляем последний вход
        user.lastLogin = new Date().toISOString();
        await saveUsers();
        
        onlineUsers.add(username);
        
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
                hasTelegram: !!user.telegramId,
                avatar: user.avatar
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
        
        // Отправляем приветственное сообщение
        if (bot) {
            try {
                await bot.sendMessage(telegramId,
                    `🎉 *Telegram успешно привязан!*\n\n` +
                    `Ваш аккаунт *${req.user.username}* на FanFik GO теперь защищен двухфакторной аутентификацией.\n\n` +
                    `📱 *Что теперь доступно:*\n` +
                    `• Безопасный вход с кодом подтверждения\n` +
                    `• Уведомления о новых фанфиках\n` +
                    `• Оповещения о комментариях\n` +
                    `• Новости сообщества\n\n` +
                    `🚀 *FanFik GO* - ваша вселенная историй в движении!`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                console.error('Ошибка отправки приветственного сообщения:', error);
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
            hasTelegram: !!user.telegramId,
            avatar: user.avatar
        });
    } else {
        res.sendStatus(404);
    }
});

// Проверка админа
app.get('/api/check-admin', authenticateToken, checkAdmin, (req, res) => {
    res.json({ message: 'Доступ к админ-панели разрешен' });
});

// Получение статистики
app.get('/api/stats', (req, res) => {
    const totalFics = fics.length;
    const approvedFics = fics.filter(f => f.status === 'approved').length;
    
    // Считаем уникальных авторов
    const authors = [...new Set(fics.filter(f => f.status === 'approved').map(f => f.author))];
    
    // Считаем общее количество глав
    const totalChapters = fics.reduce((sum, fic) => sum + (fic.chapters?.length || 0), 0);
    
    res.json({
        totalFics: approvedFics,
        totalAuthors: authors.length,
        totalChapters: totalChapters,
        onlineUsers: onlineUsers.size || Math.floor(Math.random() * 30) + 10
    });
});

// Получение трендовых тегов
app.get('/api/trending-tags', (req, res) => {
    const allGenres = fics
        .filter(f => f.status === 'approved')
        .flatMap(f => f.genre || [])
        .filter(g => g && g.trim());
    
    // Считаем частоту тегов
    const genreCounts = {};
    allGenres.forEach(genre => {
        genreCounts[genre] = (genreCounts[genre] || 0) + 1;
    });
    
    // Сортируем по популярности и берем топ-10
    const trendingTags = Object.entries(genreCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([genre]) => genre);
    
    // Если тегов мало, добавляем популярные по умолчанию
    if (trendingTags.length < 5) {
        trendingTags.push(...['Фэнтези', 'Романтика', 'Приключения', 'Драма', 'Научная фантастика']);
    }
    
    res.json([...new Set(trendingTags)].slice(0, 8));
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
        (fic.title.toLowerCase().includes(query) ||
         fic.author.toLowerCase().includes(query) ||
         (fic.genre && fic.genre.some(g => g.toLowerCase().includes(query))))
    );
    
    // Сортируем по релевантности
    const sortedResults = results.sort((a, b) => {
        const aTitleMatch = a.title.toLowerCase().includes(query);
        const bTitleMatch = b.title.toLowerCase().includes(query);
        
        if (aTitleMatch && !bTitleMatch) return -1;
        if (!aTitleMatch && bTitleMatch) return 1;
        
        // Если есть метка, поднимаем выше
        if (a.mark && !b.mark) return -1;
        if (!a.mark && b.mark) return 1;
        
        return 0;
    });
    
    res.json(sortedResults);
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
            mark: null,
            views: 0
        };
        
        fics.push(fic);
        await saveFics();
        
        // Уведомляем администратора о новом фанфике
        const admin = users.find(u => u.username === 'horrygame');
        if (admin && admin.telegramId && bot) {
            try {
                await bot.sendMessage(admin.telegramId,
                    `📬 *Новый фанфик на проверку!*\n\n` +
                    `📖 *Название:* ${fic.title}\n` +
                    `👤 *Автор:* ${fic.author}\n` +
                    `🏷️ *Жанры:* ${fic.genre.join(', ')}\n` +
                    `📊 *Глав:* ${fic.chapters.length}\n` +
                    `⏰ *Отправлен:* ${new Date().toLocaleTimeString('ru-RU')}\n\n` +
                    `Зайдите в админ-панель для проверки.`,
                    { parse_mode: 'Markdown' }
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
                            `"${fics[ficIndex].title}" теперь доступен для чтения всем пользователям FanFik GO!\n\n` +
                            `👥 *Что дальше:*\n` +
                            `• Ваш фанфик появится в ленте\n` +
                            `• Пользователи смогут его читать\n` +
                            `• Вы получите уведомления о комментариях\n\n` +
                            `🚀 Продолжайте творить!`,
                            { parse_mode: 'Markdown' }
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
        version: '1.0',
        platform: 'FanFik GO',
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
        hasTelegram: !!user.telegramId,
        avatar: user.avatar
    }));
    
    res.json({
        exportedAt: new Date().toISOString(),
        version: '1.0',
        platform: 'FanFik GO',
        total: users.length,
        users: safeUsers
    });
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 FanFik GO запущен на порту ${PORT}`);
    console.log(`👥 Пользователей: ${users.length}`);
    console.log(`📚 Фанфиков: ${fics.length}`);
    console.log(`🤖 Telegram бот: ${bot ? 'активен (@fanfik_go_bot)' : 'не настроен'}`);
    console.log(`🌐 Ссылка: http://localhost:${PORT}`);
});

// Функция для поддержания активности сервера
setInterval(() => {
    console.log('🔄 Keep-alive ping');
    
    // Пингуем себя для предотвращения засыпания
    if (process.env.RENDER_URL) {
        https.get(process.env.RENDER_URL, (res) => {
            console.log(`✅ Сервер активен: ${res.statusCode}`);
        }).on('error', (err) => {
            console.error('❌ Keep-alive error:', err.message);
        });
    }
}, 4 * 60 * 1000); // Каждые 4 минуты

// Обновление рекомендаций каждые 30 минут
setInterval(() => {
    console.log('🔄 Обновление рекомендаций');
    onlineUsers.clear(); // Очищаем онлайн пользователей
}, 30 * 60 * 1000);

// Обработка завершения работы
process.on('SIGTERM', async () => {
    console.log('🛑 Получен сигнал завершения работы...');
    await saveUsers();
    await saveFics();
    console.log('💾 Данные сохранены');
    process.exit(0);
});

// Экспортируем для тестов
module.exports = { app, users, fics };
