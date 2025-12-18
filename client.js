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
        this.setupAutoStatsUpdate(); // Добавляем автообновление статистики
    }

    setupAutoStatsUpdate() {
        // Обновляем статистику каждую минуту
        setInterval(() => {
            this.updateStatsDisplay();
        }, 60 * 1000);
        
        // Первое обновление через 5 секунд
        setTimeout(() => {
            this.updateStatsDisplay();
        }, 5000);
    }

    async updateStatsDisplay() {
        try {
            const response = await fetch(`${this.apiBase}/api/stats`);
            if (response.ok) {
                const stats = await response.json();
                console.log(`📊 Статистика обновлена: ${stats.totalUsers} пользователей, ${stats.totalFics} фанфиков`);
                
                // Можно обновлять статистику на странице, если нужно
                // Например, в админ-панели или в футере
            }
        } catch (error) {
            console.log('Обновление статистики пропущено (оффлайн)');
        }
    }

    setupEventListeners() {
        // ... остальной код без изменений ...
    }

    // ... остальные методы без изменений ...
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    window.fanFikClient = new FanFikClient();
});
