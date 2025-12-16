class FicClient {
    constructor() {
        this.apiBase = window.location.origin;
        this.currentUser = null;
        this.currentFic = null;
        this.chapters = [];
        this.init();
    }

    async init() {
        this.loadFics();
        this.setupEventListeners();
        this.checkAuth();
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
                }
            }
        } catch (error) {
            console.error('Auth check failed:', error);
        }
    }

    async handleAuth() {
        const username = document.getElementById('authUsername').value;
        const password = document.getElementById('authPassword').value;
        const telegramId = document.getElementById('authTelegram').value;
        
        const isLogin = document.getElementById('authTitle').textContent === 'Вход';
        
        try {
            const endpoint = isLogin ? '/api/login' : '/api/register';
            const payload = isLogin ? { username, password, telegramId } : { username, password };
            
            const response = await fetch(`${this.apiBase}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            if (response.ok) {
                const data = await response.json();
                
                if (data.require2FA) {
                    this.showTelegramField();
                    return;
                }
                
                if (data.token) {
                    localStorage.setItem('token', data.token);
                    this.currentUser = data.user;
                    this.updateUIAfterLogin();
                    this.hideAuthModal();
                    alert(isLogin ? 'Вход выполнен!' : 'Регистрация успешна!');
                }
            } else {
                alert('Ошибка авторизации');
            }
        } catch (error) {
            console.error('Auth error:', error);
            alert('Ошибка соединения');
        }
    }

    updateUIAfterLogin() {
        document.getElementById('loginBtn').style.display = 'none';
        document.getElementById('registerBtn').style.display = 'none';
        document.getElementById('logoutBtn').style.display = 'block';
        
        if (this.currentUser.username === 'horrygame') {
            document.getElementById('adminBtn').style.display = 'block';
        }
    }

    async logout() {
        localStorage.removeItem('token');
        this.currentUser = null;
        document.getElementById('loginBtn').style.display = 'block';
        document.getElementById('registerBtn').style.display = 'block';
        document.getElementById('logoutBtn').style.display = 'none';
        document.getElementById('adminBtn').style.display = 'none';
        document.getElementById('createFicBtn').style.display = 'none';
    }

    showAuthModal(mode) {
        const modal = document.getElementById('authModal');
        const title = document.getElementById('authTitle');
        const submitBtn = document.getElementById('authSubmitBtn');
        const switchText = document.getElementById('authSwitch');
        
        if (mode === 'login') {
            title.textContent = 'Вход';
            submitBtn.textContent = 'Войти';
            switchText.textContent = 'Нет аккаунта? Зарегистрируйтесь';
        } else {
            title.textContent = 'Регистрация';
            submitBtn.textContent = 'Зарегистрироваться';
            switchText.textContent = 'Уже есть аккаунт? Войдите';
        }
        
        modal.style.display = 'block';
    }

    showTelegramField() {
        document.getElementById('authTelegram').style.display = 'block';
        document.getElementById('authSubmitBtn').textContent = 'Подтвердить 2FA';
    }

    switchAuthMode() {
        const title = document.getElementById('authTitle');
        if (title.textContent === 'Вход') {
            this.showAuthModal('register');
        } else {
            this.showAuthModal('login');
        }
    }

    hideAuthModal() {
        document.getElementById('authModal').style.display = 'none';
        document.getElementById('authTelegram').style.display = 'none';
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
        
        this.currentFic.chapters.push({ title, content });
        this.updateChaptersList();
        
        document.getElementById('chapterTitle').value = '';
        document.getElementById('ficContent').value = '';
    }

    updateChaptersList() {
        const list = document.getElementById('chaptersList');
        list.innerHTML = '';
        
        this.currentFic.chapters.forEach((chapter, index) => {
            const div = document.createElement('div');
            div.className = 'chapter-item';
            div.textContent = `Глава ${index + 1}: ${chapter.title}`;
            div.addEventListener('click', () => this.loadChapter(index));
            list.appendChild(div);
        });
    }

    loadChapter(index) {
        const chapter = this.currentFic.chapters[index];
        document.getElementById('chapterTitle').value = chapter.title;
        document.getElementById('ficContent').value = chapter.content;
        this.currentFic.currentChapter = index;
    }

    async submitFic() {
        if (!this.currentFic.chapters.length) {
            alert('Добавьте хотя бы одну главу');
            return;
        }
        
        const fic = {
            title: document.getElementById('ficTitle').value,
            author: document.getElementById('ficAuthor').value,
            genre: document.getElementById('ficGenre').value,
            age: document.getElementById('ficAge').value,
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
            }
        } catch (error) {
            console.error('Submit error:', error);
        }
    }

    async loadFics() {
        try {
            const response = await fetch(`${this.apiBase}/api/fics`);
            const fics = await response.json();
            this.displayFics(fics);
        } catch (error) {
            console.error('Load fics error:', error);
        }
    }

    displayFics(fics) {
        const container = document.getElementById('ficsContainer');
        container.innerHTML = '';
        
        fics.forEach(fic => {
            if (fic.status === 'approved') {
                const card = document.createElement('div');
                card.className = 'fic-card';
                card.innerHTML = `
                    <h3 class="fic-title">${fic.title}</h3>
                    <p class="fic-author">Автор: ${fic.author}</p>
                    <span class="fic-genre">${fic.genre}</span>
                    <p>Возраст: ${fic.age}</p>
                    <p>${fic.chapters[0]?.content.substring(0, 150)}...</p>
                `;
                container.appendChild(card);
            }
        });
    }

    async searchFics(query) {
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
        this.currentFic = null;
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
