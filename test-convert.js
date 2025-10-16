const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Конфигурация для теста
const CONFIG = {
    htmlPath: './convert-headless.html',
    codec: 'image/png', // PNG sequence для полной прозрачности
    extension: '.zip',
    framerate: null,
    speed: 1,
    bitrate: 5120,
    width: null,
    height: null,
};

async function testConversion() {
    console.log('=== Тест конвертации Lottie в видео ===\n');

    // Найти первую папку в models
    const modelsDir = './models';
    if (!fs.existsSync(modelsDir)) {
        console.error('Ошибка: Папка models не найдена');
        return;
    }

    const folders = fs.readdirSync(modelsDir).filter(item => {
        return fs.statSync(path.join(modelsDir, item)).isDirectory();
    });

    if (folders.length === 0) {
        console.error('Ошибка: В папке models нет подпапок');
        return;
    }

    const testFolder = path.join(modelsDir, folders[0]);
    console.log(`Тестовая папка: ${testFolder}`);

    // Найти первый JSON файл
    const files = fs.readdirSync(testFolder).filter(f => f.endsWith('.json'));

    if (files.length === 0) {
        console.error('Ошибка: В папке нет JSON файлов');
        return;
    }

    const testFile = path.join(testFolder, files[0]);
    console.log(`Тестовый файл: ${testFile}`);
    console.log('');

    // Создать папку для теста
    const testOutputDir = './test_output';
    if (!fs.existsSync(testOutputDir)) {
        fs.mkdirSync(testOutputDir, { recursive: true });
    }

    const outputFile = path.join(testOutputDir, files[0].replace('.json', CONFIG.extension));

    console.log('Запуск браузера...');
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
        ],
    });
    console.log('✓ Браузер запущен\n');

    try {
        const page = await browser.newPage();

        console.log('Загрузка HTML страницы...');
        const htmlUrl = 'file:///' + path.resolve(CONFIG.htmlPath).replace(/\\/g, '/');
        await page.goto(htmlUrl, { waitForTimeout: 2000 });
        console.log('✓ HTML загружен\n');

        console.log('Ожидание готовности конвертера...');
        await page.waitForFunction(() => window.converterReady === true, { timeout: 10000 });
        console.log('✓ Конвертер готов\n');

        console.log('Чтение JSON файла...');
        const jsonContent = fs.readFileSync(testFile, 'utf8');
        const jsonData = JSON.parse(jsonContent);
        console.log(`✓ JSON прочитан (размер: ${jsonData.w}x${jsonData.h})\n`);

        console.log('Начинаем конвертацию...');
        console.log('(Это может занять 5-30 секунд)\n');

        const startTime = Date.now();

        const result = await page.evaluate(async(jsonData, options) => {
            try {
                const result = await window.convertLottieToVideo(jsonData, options);
                return result;
            } catch (error) {
                return { success: false, error: error.message };
            }
        }, jsonData, {
            width: CONFIG.width,
            height: CONFIG.height,
            framerate: CONFIG.framerate,
            speed: CONFIG.speed,
            mimeType: CONFIG.codec,
            bitrate: CONFIG.bitrate,
        });

        const endTime = Date.now();
        const totalTime = ((endTime - startTime) / 1000).toFixed(2);

        if (!result.success) {
            throw new Error(result.error);
        }

        console.log('✓ Конвертация завершена!\n');
        console.log(`Информация о видео:`);
        console.log(`  Размер: ${result.width}x${result.height}`);
        console.log(`  Длительность: ${result.duration.toFixed(2)}s`);
        console.log(`  Кадров: ${result.frames}`);
        console.log(`  FPS: ${result.fps}`);
        console.log(`  Время конвертации: ${totalTime}s\n`);

        console.log('Сохранение видео файла...');
        const buffer = Buffer.from(result.data);
        fs.writeFileSync(outputFile, buffer);

        const fileSize = (buffer.length / 1024).toFixed(2);
        console.log(`✓ Видео сохранено: ${outputFile}`);
        console.log(`  Размер файла: ${fileSize} KB\n`);

        await page.close();

    } catch (error) {
        console.error('\n✗ ОШИБКА:', error.message);
        console.error('\nВозможные причины:');
        console.error('  - Не установлен Chrome/Chromium');
        console.error('  - Файл convert-headless.html не найден');
        console.error('  - Проблемы с кодеком видео в браузере');
        console.error('  - Недостаточно памяти\n');
    }

    await browser.close();
    console.log('✓ Браузер закрыт\n');

    console.log('=== Тест завершен ===');
    console.log('\nЕсли все прошло успешно, проверьте файл:');
    console.log(`  ${outputFile}`);
    console.log('\nТеперь можно запускать полную конвертацию:');
    console.log('  node convert-all.js         - конвертировать всё');
    console.log('  node convert-folder.js <папка> - конвертировать одну папку');
}

testConversion().catch(console.error);