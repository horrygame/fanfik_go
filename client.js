class FicClient {
    constructor() {
        this.apiBase = window.location.origin;
        this.currentUser = null;
        this.currentFic = {
            chapters: [],
            currentChapter: 0
        };
        this.init();
    }

    async init() {
        this.loadFics();
        this.setupEventListeners();
        await this.checkAuth();
        this.setupRecommendationRefresh();
    }

    setupEventListeners() {
        // Кнопки авторизации
        document.getElementById('loginBtn').addEventListener('click', () => this.showAuthModal('login'));
        document.getElementById('registerBtn').addEventListener('click', () => this.showAuthModal('register'));
        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());
        document.getElementById('adminBtn').addEventListener('click', () => window.open('/admin.html', '_blank'));
        
        // Закрытие модальных окон
        document.getElementById('closeCreateModal').addEventListener('click', () => this.hideCreateModal());
        document.getElementById('closeAuthModal').addEventListener('click', () => this.hideAuthModal());
        
        // Создание фанфика
        document.getElementById('createFicBtn').addEventListener('click', () => this.showCreateModal());
        document.getElementById('addChapterBtn').addEventListener('click', () => this.addChapter());
        document.getElementById('submitFicBtn').addEventListener('click', () => this.submitFic());
        
        // Авторизация
        document.getElementById('authSubmitBtn').addEventListener('click', () => this.handleAuth());
        document.getElementById('authSwitch').addEventListener('click', () => this.switchAuthMode());
        
        // Поиск
        document.getElementById('searchInput').addEventListener('input', (e) => this.searchFics(e.target.value));
        
        // Клик по фону для закрытия модалок
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.hideCreateModal();
                this.hideAuthModal();
            }
        });
    }

    async checkAuth() {
        try {
            const token = localStorage.getItem('token');
            if (token) {
                const response = await fetch(`${this.apiBase}/api/check-auth`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (response.ok) {
                    const user = await response.json();
                    this.currentUser = user;
                    this.updateUIAfterLogin();
                    
                    // Проверяем, привязан ли Telegram
                    if (!user.hasTelegram) {
                        this.showTelegramNotice();
                    }
                } else {
                    localStorage.removeItem('token');
                }
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            localStorage.removeItem('token');
        }
    }

    async handleAuth() {
        const username = document.getElementById('authUsername').value;
        const password = document.getElementById('authPassword').value;
        const telegramId = document.getElementById('authTelegram').value;
        
        const isLogin = document.getElementById('authTitle').textContent.includes('Вход');
        
        if (!username || !password) {
            alert('Заполните никнейм и пароль');
            return;
        }
        
        try {
            const endpoint = isLogin ? '/api/login' : '/api/register';
            const payload = isLogin ? { username, password, telegramId } : { username, password };
            
            const response = await fetch(`${this.apiBase}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            const data = await response.json();
            
            if (response.ok) {
                if (data.require2FA) {
                    this.showTelegramField();
                    return;
                }
                
                if (data.token) {
                    localStorage.setItem('token', data.token);
                    this.currentUser = data.user;
                    this.updateUIAfterLogin();
                    this.hideAuthModal();
                    
                    if (!data.user.hasTelegram) {
                        this.showTelegramNotice();
                    }
                    
                    alert(isLogin ? 'Вход выполнен!' : 'Регистрация успешна!');
                }
            } else {
                alert(data.error || 'Ошибка авторизации');
            }
        } catch (error) {
            console.error('Auth error:', error);
            alert('Ошибка соединения с сервером');
        }
    }

    updateUIAfterLogin() {
        document.getElementById('loginBtn').style.display = 'none';
        document.getElementById('registerBtn').style.display = 'none';
        document.getElementById('logoutBtn').style.display = 'block';
        document.getElementById('createFicBtn').style.display = 'block';
        
        if (this.currentUser.username === 'horrygame') {
            document.getElementById('adminBtn').style.display = 'block';
        }
        
        document.getElementById('welcomeMessage').style.display = 'none';
    }

    showTelegramNotice() {
        const notice = document.getElementById('telegramNotice');
        notice.style.display = 'flex';
        
        // Скрыть через 10 секунд
        setTimeout(() => {
            notice.style.display = 'none';
        }, 10000);
    }

    async logout() {
        localStorage.removeItem('token');
        this.currentUser = null;
        document.getElementById('loginBtn').style.display = 'block';
        document.getElementById('registerBtn').style.display = 'block';
        document.getElementById('logoutBtn').style.display = 'none';
        document.getElementById('adminBtn').style.display = 'none';
        document.getElementById('telegramNotice').style.display = 'none';
        document.getElementById('createFicBtn').style.display = 'none';
        document.getElementById('welcomeMessage').style.display = 'block';
        this.loadFics();
    }

    showAuthModal(mode) {
        const modal = document.getElementById('authModal');
        const title = document.getElementById('authTitle');
        const submitBtn = document.getElementById('authSubmitBtn');
        const switchText = document.getElementById('authSwitch');
        const telegramHelp = document.getElementById('telegramHelp');
        
        if (mode === 'login') {
            title.innerHTML = '<i class="fas fa-key"></i> Вход';
            submitBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Войти';
            switchText.textContent = 'Нет аккаунта? Зарегистрируйтесь';
            telegramHelp.style.display = 'block';
        } else {
            title.innerHTML = '<i class="fas fa-user-plus"></i> Регистрация';
            submitBtn.innerHTML = '<i class="fas fa-user-plus"></i> Зарегистрироваться';
            switchText.textContent = 'Уже есть аккаунт? Войдите';
            telegramHelp.style.display = 'none';
        }
        
        modal.style.display = 'block';
    }

    showTelegramField() {
        document.getElementById('authTelegram').style.display = 'block';
        document.getElementById('telegramHelp').style.display = 'block';
        document.getElementById('authSubmitBtn').innerHTML = '<i class="fas fa-shield-alt"></i> Подтвердить 2FA';
    }

    switchAuthMode() {
        const title = document.getElementById('authTitle');
        if (title.textContent.includes('Вход')) {
            this.showAuthModal('register');
        } else {
            this.showAuthModal('login');
        }
    }

    hideAuthModal() {
        document.getElementById('authModal').style.display = 'none';
        document.getElementById('authTelegram').style.display = 'none';
        document.getElementById('telegramHelp').style.display = 'none';
        document.getElementById('authTelegram').value = '';
        document.getElementById('authUsername').value = '';
        document.getElementById('authPassword').value = '';
    }

    showCreateModal() {
        if (!this.currentUser) {
            alert('Для создания фанфика необходимо авторизоваться');
            return;
        }
        
        document.getElementById('createModal').style.display = 'block';
        this.currentFic = {
            chapters: [],
            currentChapter: 0
        };
        this.updateChaptersList();
    }

    hideCreateModal() {
        document.getElementById('createModal').style.display = 'none';
        this.clearCreateForm();
    }

    addChapter() {
        const title = document.getElementById('chapterTitle').value;
        const content = document.getElementById('ficContent').value;
        
        if (!title || !content) {
            alert('Заполните название и текст главы');
            return;
        }
        
        const chapterIndex = this.currentFic.currentChapter;
        
        if (this.currentFic.chapters[chapterIndex]) {
            // Обновляем существующую главу
            this.currentFic.chapters[chapterIndex] = { title, content };
        } else {
            // Добавляем новую главу
            this.currentFic.chapters.push({ title, content });
        }
        
        this.updateChaptersList();
        
        document.getElementById('chapterTitle').value = '';
        document.getElementById('ficContent').value = '';
        
        // Сбрасываем выбор главы
        this.currentFic.currentChapter = this.currentFic.chapters.length;
    }

    updateChaptersList() {
        const list = document.getElementById('chaptersList');
        list.innerHTML = '';
        
        this.currentFic.chapters.forEach((chapter, index) => {
            const div = document.createElement('div');
            div.className = `chapter-item ${index === this.currentFic.currentChapter ? 'active' : ''}`;
            div.innerHTML = `
                <div class="chapter-number">Глава ${index + 1}</div>
                <div class="chapter-title">${chapter.title}</div>
            `;
            div.addEventListener('click', () => this.loadChapter(index));
            list.appendChild(div);
        });
    }

    loadChapter(index) {
        const chapter = this.currentFic.chapters[index];
        document.getElementById('chapterTitle').value = chapter.title;
        document.getElementById('ficContent').value = chapter.content;
        this.currentFic.currentChapter = index;
        this.updateChaptersList();
    }

    async submitFic() {
        if (!this.currentFic.chapters.length) {
            alert('Добавьте хотя бы одну главу');
            return;
        }
        
        const title = document.getElementById('ficTitle').value;
        const author = document.getElementById('ficAuthor').value;
        const genre = document.getElementById('ficGenre').value;
        const age = document.getElementById('ficAge').value;
        
        if (!title || !author || !genre) {
            alert('Заполните все обязательные поля');
            return;
        }
        
        const fic = {
            title,
            author,
            genre: genre.split(',').map(g => g.trim()),
            age,
            chapters: this.currentFic.chapters,
            status: 'pending'
        };
        
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${this.apiBase}/api/submit-fic`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(fic)
            });
            
            if (response.ok) {
                alert('Фанфик отправлен на рассмотрение!');
                this.hideCreateModal();
                this.loadFics();
            } else {
                const error = await response.json();
                alert(error.error || 'Ошибка при отправке');
            }
        } catch (error) {
            console.error('Submit error:', error);
            alert('Ошибка соединения с сервером');
        }
    }

    async loadFics() {
        try {
            const response = await fetch(`${this.apiBase}/api/fics`);
            const fics = await response.json();
            this.displayFics(fics);
        } catch (error) {
            console.error('Load fics error:', error);
            this.showEmptyState();
        }
    }

    displayFics(fics) {
        const container = document.getElementById('ficsContainer');
        container.innerHTML = '';
        
        if (!fics || fics.length === 0) {
            this.showEmptyState();
            return;
        }
        
        fics.forEach(fic => {
            if (fic.status === 'approved') {
                const card = this.createFicCard(fic);
                container.appendChild(card);
            }
        });
    }

    createFicCard(fic) {
        const card = document.createElement('div');
        card.className = 'fic-card';
        
        let markBadge = '';
        if (fic.mark) {
            const markClasses = {
                'liked': 'mark-liked',
                'moderator': 'mark-moderator',
                'featured': 'mark-featured',
                'new': 'mark-new'
            };
            const markTexts = {
                'liked': '👍 Понравилось',
                'moderator': '👑 От модератора',
                'featured': '⭐ Избранное',
                'new': '🆕 Новинка'
            };
            markBadge = `<span class="mark-badge ${markClasses[fic.mark]}">${markTexts[fic.mark]}</span>`;
        }
        
        card.innerHTML = `
            <h3 class="fic-title">${fic.title} ${markBadge}</h3>
            <p class="fic-author">
                <i class="fas fa-user-edit"></i> ${fic.author}
                <span class="fic-age">${fic.age}</span>
            </p>
            <div>
                ${fic.genre.map(g => `<span class="fic-genre">${g}</span>`).join('')}
            </div>
            <div class="fic-preview">
                ${fic.chapters[0]?.content.substring(0, 200)}...
            </div>
        `;
        
        return card;
    }

    showEmptyState() {
        const container = document.getElementById('ficsContainer');
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-book"></i>
                <h3>Здесь пока пусто</h3>
                <p>Будьте первым, кто напишет фанфик!</p>
                <button id="writeFirstBtn" style="margin-top: 1.5rem;">
                    <i class="fas fa-feather-alt"></i> Написать первую историю
                </button>
            </div>
        `;
        
        document.getElementById('writeFirstBtn').addEventListener('click', () => {
            this.showCreateModal();
        });
    }

    async searchFics(query) {
        if (!query.trim()) {
            this.loadFics();
            return;
        }
        
        try {
            const response = await fetch(`${this.apiBase}/api/search?q=${encodeURIComponent(query)}`);
            const fics = await response.json();
            this.displayFics(fics);
        } catch (error) {
            console.error('Search error:', error);
        }
    }

    clearCreateForm() {
        document.getElementById('ficTitle').value = '';
        document.getElementById('ficAuthor').value = '';
        document.getElementById('ficGenre').value = '';
        document.getElementById('ficAge').value = '0+';
        document.getElementById('chapterTitle').value = '';
        document.getElementById('ficContent').value = '';
        this.currentFic = {
            chapters: [],
            currentChapter: 0
        };
        this.updateChaptersList();
    }

    setupRecommendationRefresh() {
        setInterval(() => {
            this.loadFics();
        }, 30 * 60 * 1000); // 30 минут
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    window.ficClient = new FicClient();
});
