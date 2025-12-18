class FanFikClient {
    constructor() {
        this.apiBase = window.location.origin;
        this.currentUser = null;
        this.currentFic = {
            chapters: [
                { title: "Глава 1", content: "" }
            ],
            currentChapter: 0
        };
        this.currentReadingFic = null;
        this.currentReadingChapter = 0;
        this.init();
    }

    async init() {
        this.loadFics();
        this.setupEventListeners();
        await this.checkAuth();
    }

    setupEventListeners() {
        // Кнопки авторизации
        document.getElementById('loginBtn').addEventListener('click', () => this.showAuthModal('login'));
        document.getElementById('registerBtn').addEventListener('click', () => this.showAuthModal('register'));
        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());
        document.getElementById('adminBtn').addEventListener('click', () => window.open('/admin.html', '_blank'));
        
        // Кнопка привязки Telegram
        document.getElementById('telegramBindBtn').addEventListener('click', () => this.showTelegramModal());
        
        // Ссылка "Забыли пароль?"
        document.getElementById('forgotPasswordLink').addEventListener('click', () => this.showForgotPasswordModal());
        
        // Закрытие модальных окон
        document.getElementById('closeCreateModal').addEventListener('click', () => this.hideCreateModal());
        document.getElementById('closeAuthModal').addEventListener('click', () => this.hideAuthModal());
        document.getElementById('closeTelegramModal').addEventListener('click', () => this.hideTelegramModal());
        document.getElementById('closeFicReaderModal').addEventListener('click', () => this.hideFicReaderModal());
        document.getElementById('closeForgotPasswordModal').addEventListener('click', () => this.hideForgotPasswordModal());
        
        // Создание фанфика
        document.getElementById('createFicBtn').addEventListener('click', () => this.showCreateModal());
        document.getElementById('addChapterBtn').addEventListener('click', () => this.addChapter());
        document.getElementById('submitFicBtn').addEventListener('click', () => this.submitFic());
        
        // Авторизация
        document.getElementById('authSubmitBtn').addEventListener('click', () => this.handleAuth());
        document.getElementById('authSwitch').addEventListener('click', () => this.switchAuthMode());
        
        // Привязка Telegram
        document.getElementById('bindTelegramBtn').addEventListener('click', () => this.bindTelegram());
        
        // Сброс пароля
        document.getElementById('sendResetLinkBtn').addEventListener('click', () => this.sendResetLink());
        
        // Поиск
        document.getElementById('searchInput').addEventListener('input', (e) => this.searchFics(e.target.value));
        
        // Навигация по главам при чтении
        document.getElementById('prevChapterBtn').addEventListener('click', () => this.prevChapter());
        document.getElementById('nextChapterBtn').addEventListener('click', () => this.nextChapter());
        
        // Клик по фону для закрытия модалок
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.hideCreateModal();
                this.hideAuthModal();
                this.hideTelegramModal();
                this.hideFicReaderModal();
                this.hideForgotPasswordModal();
            }
        });
        
        // Загрузка главы при клике на нее в списке
        document.getElementById('chaptersList').addEventListener('click', (e) => {
            const chapterItem = e.target.closest('.chapter-item');
            if (chapterItem && chapterItem.dataset.index) {
                const index = parseInt(chapterItem.dataset.index);
                this.loadChapter(index);
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
                    
                    // Показываем кнопку привязки Telegram, если не привязан
                    if (!user.hasTelegram) {
                        document.getElementById('telegramBindBtn').style.display = 'block';
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
        const username = document.getElementById('authUsername').value.trim();
        const password = document.getElementById('authPassword').value;
        const code = document.getElementById('authCode').value.trim();
        const authMessage = document.getElementById('authMessage');
        
        const isLogin = document.getElementById('authTitle').textContent.includes('Вход');
        
        if (!username || !password) {
            this.showAuthMessage('Введите имя пользователя и пароль', 'error');
            return;
        }
        
        try {
            const endpoint = isLogin ? '/api/login' : '/api/register';
            const payload = { username, password };
            
            // Добавляем код подтверждения, если это вход и код введен
            if (isLogin && code) {
                payload.code = code;
            }
            
            const response = await fetch(`${this.apiBase}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            const data = await response.json();
            
            if (response.ok) {
                if (data.require2FA) {
                    // Показываем поле для ввода кода
                    document.getElementById('authCode').style.display = 'block';
                    this.showAuthMessage('Код подтверждения отправлен в Telegram. Введите его ниже.', 'info');
                    return;
                }
                
                if (data.token) {
                    localStorage.setItem('token', data.token);
                    this.currentUser = data.user;
                    this.updateUIAfterLogin();
                    this.hideAuthModal();
                    
                    if (!data.user.hasTelegram) {
                        document.getElementById('telegramBindBtn').style.display = 'block';
                    }
                    
                    this.showAuthMessage(isLogin ? 'Вход выполнен!' : 'Регистрация успешна!', 'success', true);
                    setTimeout(() => {
                        this.showAuthMessage('', '', false);
                    }, 2000);
                }
            } else {
                this.showAuthMessage(data.error || 'Ошибка авторизации', 'error');
            }
        } catch (error) {
            console.error('Auth error:', error);
            this.showAuthMessage('Ошибка соединения с сервером', 'error');
        }
    }

    showAuthMessage(message, type, show = true) {
        const authMessage = document.getElementById('authMessage');
        if (!show) {
            authMessage.style.display = 'none';
            return;
        }
        
        authMessage.textContent = message;
        authMessage.style.display = 'block';
        authMessage.style.backgroundColor = type === 'error' ? '#ffebee' : 
                                          type === 'info' ? '#e3f2fd' : '#e8f5e9';
        authMessage.style.color = type === 'error' ? '#c62828' : 
                                 type === 'info' ? '#1565c0' : '#2e7d32';
    }

    showForgotPasswordModal() {
        document.getElementById('forgotPasswordModal').style.display = 'block';
        document.getElementById('forgotUsername').value = '';
        this.showForgotMessage('', '', false);
    }

    hideForgotPasswordModal() {
        document.getElementById('forgotPasswordModal').style.display = 'none';
    }

    async sendResetLink() {
        const username = document.getElementById('forgotUsername').value.trim();
        
        if (!username) {
            this.showForgotMessage('Введите имя пользователя', 'error');
            return;
        }
        
        try {
            const response = await fetch(`${this.apiBase}/api/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.showForgotMessage('Ссылка для сброса пароля отправлена в ваш Telegram аккаунт', 'success');
                setTimeout(() => {
                    this.hideForgotPasswordModal();
                    this.showForgotMessage('', '', false);
                }, 3000);
            } else {
                this.showForgotMessage(data.error || 'Ошибка при отправке ссылки', 'error');
            }
        } catch (error) {
            console.error('Forgot password error:', error);
            this.showForgotMessage('Ошибка соединения с сервером', 'error');
        }
    }

    showForgotMessage(message, type, show = true) {
        const forgotMessage = document.getElementById('forgotMessage');
        if (!show) {
            forgotMessage.style.display = 'none';
            return;
        }
        
        forgotMessage.textContent = message;
        forgotMessage.style.display = 'block';
        forgotMessage.style.backgroundColor = type === 'error' ? '#ffebee' : '#e8f5e9';
        forgotMessage.style.color = type === 'error' ? '#c62828' : '#2e7d32';
    }

    async bindTelegram() {
        const chatId = document.getElementById('telegramChatId').value.trim();
        
        if (!chatId) {
            alert('Введите Chat ID');
            return;
        }
        
        if (!/^\d+$/.test(chatId)) {
            alert('Chat ID должен содержать только цифры');
            return;
        }
        
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${this.apiBase}/api/bind-telegram`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ telegramId: chatId })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                alert('Telegram успешно привязан! Теперь при входе потребуется код подтверждения из Telegram.');
                document.getElementById('telegramBindBtn').style.display = 'none';
                this.hideTelegramModal();
            } else {
                alert(data.error || 'Ошибка при привязке Telegram');
            }
        } catch (error) {
            console.error('Bind Telegram error:', error);
            alert('Ошибка соединения с сервером');
        }
    }

    updateUIAfterLogin() {
        document.getElementById('loginBtn').style.display = 'none';
        document.getElementById('registerBtn').style.display = 'none';
        document.getElementById('logoutBtn').style.display = 'block';
        document.getElementById('createFicBtn').style.display = 'block';
        
        // Устанавливаем никнейм в поле автора
        document.getElementById('ficAuthor').value = this.currentUser.username;
        
        if (this.currentUser.username === 'horrygame') {
            document.getElementById('adminBtn').style.display = 'block';
        }
    }

    showTelegramModal() {
        document.getElementById('telegramModal').style.display = 'block';
        document.getElementById('telegramChatId').value = '';
    }

    hideTelegramModal() {
        document.getElementById('telegramModal').style.display = 'none';
    }

    async logout() {
        localStorage.removeItem('token');
        this.currentUser = null;
        document.getElementById('loginBtn').style.display = 'block';
        document.getElementById('registerBtn').style.display = 'block';
        document.getElementById('logoutBtn').style.display = 'none';
        document.getElementById('adminBtn').style.display = 'none';
        document.getElementById('telegramBindBtn').style.display = 'none';
        document.getElementById('createFicBtn').style.display = 'none';
        document.getElementById('ficAuthor').value = '';
        this.loadFics();
    }

    showAuthModal(mode) {
        const modal = document.getElementById('authModal');
        const title = document.getElementById('authTitle');
        const submitBtn = document.getElementById('authSubmitBtn');
        const switchText = document.getElementById('authSwitch');
        
        // Сбрасываем форму
        document.getElementById('authUsername').value = '';
        document.getElementById('authPassword').value = '';
        document.getElementById('authCode').value = '';
        document.getElementById('authCode').style.display = 'none';
        this.showAuthMessage('', '', false);
        
        if (mode === 'login') {
            title.innerHTML = '<i class="fas fa-user"></i> Вход';
            submitBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Войти';
            switchText.textContent = 'Нет аккаунта? Зарегистрируйтесь';
        } else {
            title.innerHTML = '<i class="fas fa-user-plus"></i> Регистрация';
            submitBtn.innerHTML = '<i class="fas fa-user-plus"></i> Зарегистрироваться';
            switchText.textContent = 'Уже есть аккаунт? Войдите';
        }
        
        modal.style.display = 'block';
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
    }

    showCreateModal() {
        if (!this.currentUser) {
            alert('Для создания фанфика необходимо войти');
            return;
        }
        
        document.getElementById('createModal').style.display = 'block';
        // Устанавливаем автора как никнейм текущего пользователя
        document.getElementById('ficAuthor').value = this.currentUser.username;
        this.currentFic = {
            chapters: [
                { title: "Глава 1", content: "" }
            ],
            currentChapter: 0
        };
        this.updateChaptersList();
        this.loadChapter(0);
    }

    hideCreateModal() {
        document.getElementById('createModal').style.display = 'none';
        this.clearCreateForm();
    }

    addChapter() {
        const newChapterNumber = this.currentFic.chapters.length + 1;
        
        // Добавляем новую пустую главу
        this.currentFic.chapters.push({ 
            title: `Глава ${newChapterNumber}`, 
            content: "" 
        });
        
        // Переключаемся на новую главу
        this.currentFic.currentChapter = this.currentFic.chapters.length - 1;
        this.updateChaptersList();
        this.loadChapter(this.currentFic.currentChapter);
    }

    updateChaptersList() {
        const list = document.getElementById('chaptersList');
        list.innerHTML = '';
        
        this.currentFic.chapters.forEach((chapter, index) => {
            const div = document.createElement('div');
            div.className = `chapter-item ${index === this.currentFic.currentChapter ? 'active' : ''}`;
            div.dataset.index = index;
            
            const contentPreview = chapter.content 
                ? chapter.content.substring(0, 60) + '...'
                : 'Пустая глава';
            
            div.innerHTML = `
                <div style="font-weight: 600; margin-bottom: 0.3rem;">
                    ${chapter.title}
                </div>
                <div style="font-size: 0.9rem; color: #666;">
                    ${contentPreview}
                </div>
            `;
            list.appendChild(div);
        });
    }

    loadChapter(index) {
        if (index < 0 || index >= this.currentFic.chapters.length) {
            return;
        }
        
        const chapter = this.currentFic.chapters[index];
        document.getElementById('chapterTitle').value = chapter.title;
        document.getElementById('ficContent').value = chapter.content;
        this.currentFic.currentChapter = index;
        
        // Обновляем активный элемент в списке глав
        const chapterItems = document.querySelectorAll('.chapter-item');
        chapterItems.forEach((item, i) => {
            if (i === index) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    async submitFic() {
        const title = document.getElementById('ficTitle').value.trim();
        const author = document.getElementById('ficAuthor').value.trim();
        const genre = document.getElementById('ficGenre').value.trim();
        const age = document.getElementById('ficAge').value;
        
        if (!title || !author || !genre) {
            alert('Заполните все обязательные поля');
            return;
        }
        
        // Сохраняем текущую главу перед отправкой
        const currentTitle = document.getElementById('chapterTitle').value.trim();
        const currentContent = document.getElementById('ficContent').value.trim();
        
        if (this.currentFic.currentChapter >= 0) {
            this.currentFic.chapters[this.currentFic.currentChapter] = {
                title: currentTitle || `Глава ${this.currentFic.currentChapter + 1}`,
                content: currentContent
            };
        }
        
        // Проверяем, что хотя бы одна глава не пустая
        const hasContent = this.currentFic.chapters.some(chapter => chapter.content.trim());
        if (!hasContent) {
            alert('Добавьте текст хотя бы в одну главу');
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
                alert('Фанфик отправлен на рассмотрение! Ожидайте одобрения.');
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
                'liked': '👍 Рекомендация',
                'moderator': '👑 От модератора',
                'featured': '⭐ Избранное',
                'new': '🆕 Новинка'
            };
            markBadge = `<span class="mark-badge ${markClasses[fic.mark]}">${markTexts[fic.mark]}</span>`;
        }
        
        const genreBadges = fic.genre.map(g => 
            `<span class="fic-genre">${g}</span>`
        ).join('');
        
        card.innerHTML = `
            <h3 class="fic-title">${fic.title} ${markBadge}</h3>
            <p class="fic-author">
                <i class="fas fa-user"></i> ${fic.author}
                <span class="fic-age">${fic.age}</span>
            </p>
            <div style="margin-bottom: 1.2rem;">
                ${genreBadges}
            </div>
            <div class="fic-preview">
                ${fic.chapters[0]?.content.substring(0, 200)}...
            </div>
            <div style="margin-top: 1.2rem; font-size: 0.9rem; color: #888;">
                <i class="fas fa-calendar"></i> Опубликован: ${new Date(fic.createdAt).toLocaleDateString('ru-RU')}
                <br>
                <i class="fas fa-book"></i> Глав: ${fic.chapters?.length || 1}
            </div>
        `;
        
        card.addEventListener('click', () => {
            this.showFicReader(fic);
        });
        
        return card;
    }

    async showFicReader(fic) {
        this.currentReadingFic = fic;
        this.currentReadingChapter = 0;
        
        document.getElementById('ficReaderTitle').textContent = fic.title;
        document.getElementById('ficReaderAuthor').textContent = `Автор: ${fic.author}`;
        document.getElementById('ficReaderGenre').textContent = `Жанр: ${fic.genre.join(', ')}`;
        document.getElementById('ficReaderAge').textContent = `Возраст: ${fic.age}`;
        
        this.updateReaderContent();
        document.getElementById('ficReaderModal').style.display = 'block';
    }

    updateReaderContent() {
        if (!this.currentReadingFic || !this.currentReadingFic.chapters) {
            return;
        }
        
        const chapter = this.currentReadingFic.chapters[this.currentReadingChapter];
        if (!chapter) {
            return;
        }
        
        document.getElementById('ficReaderContent').textContent = chapter.content;
        
        // Обновляем информацию о текущей главе
        document.getElementById('currentChapterInfo').textContent = 
            `Глава ${this.currentReadingChapter + 1} из ${this.currentReadingFic.chapters.length}`;
        
        // Обновляем состояние кнопок навигации
        document.getElementById('prevChapterBtn').disabled = this.currentReadingChapter === 0;
        document.getElementById('nextChapterBtn').disabled = 
            this.currentReadingChapter === this.currentReadingFic.chapters.length - 1;
    }

    prevChapter() {
        if (this.currentReadingChapter > 0) {
            this.currentReadingChapter--;
            this.updateReaderContent();
        }
    }

    nextChapter() {
        if (this.currentReadingFic && 
            this.currentReadingChapter < this.currentReadingFic.chapters.length - 1) {
            this.currentReadingChapter++;
            this.updateReaderContent();
        }
    }

    hideFicReaderModal() {
        document.getElementById('ficReaderModal').style.display = 'none';
        this.currentReadingFic = null;
        this.currentReadingChapter = 0;
    }

    showEmptyState() {
        const container = document.getElementById('ficsContainer');
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-book"></i>
                <h3>Пока нет фанфиков</h3>
                <p>Будьте первым, кто опубликует фанфик!</p>
                ${this.currentUser ? `
                    <button id="writeFirstBtn" style="margin-top: 1.5rem;">
                        <i class="fas fa-pen"></i> Написать первый фанфик
                    </button>
                ` : ''}
            </div>
        `;
        
        const writeBtn = document.getElementById('writeFirstBtn');
        if (writeBtn) {
            writeBtn.addEventListener('click', () => {
                this.showCreateModal();
            });
        }
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
        document.getElementById('ficGenre').value = '';
        document.getElementById('ficAge').value = '0+';
        document.getElementById('chapterTitle').value = '';
        document.getElementById('ficContent').value = '';
        this.currentFic = {
            chapters: [
                { title: "Глава 1", content: "" }
            ],
            currentChapter: 0
        };
        this.updateChaptersList();
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    window.fanFikClient = new FanFikClient();
});
