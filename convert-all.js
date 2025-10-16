const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Конфигурация
const CONFIG = {
    modelsDir: './models',
    outputDir: './output',
    htmlPath: './convert-headless.html',
    codec: 'video/webm;codecs="vp9"', // VP9 с прозрачностью (альфа-канал)
    extension: '.webm',
    framerate: null, // null = autodetect
    speed: 1,
    bitrate: 5120, // kbps
    width: null, // null = autodetect
    height: null, // null = autodetect
};

// Создать папку output если её нет
if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
}

// Рекурсивно получить все JSON файлы
function getAllJsonFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);

    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            getAllJsonFiles(filePath, fileList);
        } else if (file.endsWith('.json')) {
            fileList.push(filePath);
        }
    });

    return fileList;
}

// Конвертировать один файл
async function convertFile(browser, jsonFilePath) {
    const page = await browser.newPage();

    try {
        // Получить относительный путь для создания структуры папок
        const relativePath = path.relative(CONFIG.modelsDir, jsonFilePath);
        const outputPath = path.join(CONFIG.outputDir, relativePath).replace('.json', CONFIG.extension);

        // Создать папки для выходного файла
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Если файл уже существует, пропустить
        if (fs.existsSync(outputPath)) {
            console.log(`Пропускаем (уже существует): ${relativePath}`);
            await page.close();
            return { success: true, skipped: true };
        }

        console.log(`Конвертируем: ${relativePath}`);

        // Загрузить HTML страницу
        const htmlUrl = 'file:///' + path.resolve(CONFIG.htmlPath).replace(/\\/g, '/');
        await page.goto(htmlUrl, { waitForTimeout: 2000 });

        // Дождаться загрузки конвертера
        await page.waitForFunction(() => window.converterReady === true, { timeout: 10000 });

        // Прочитать JSON файл
        const jsonContent = fs.readFileSync(jsonFilePath, 'utf8');
        const jsonData = JSON.parse(jsonContent);

        // Запустить конвертацию через API
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

        if (!result.success) {
            throw new Error(result.error);
        }

        const videoBlob = result.data;

        // Сохранить видео файл
        const buffer = Buffer.from(videoBlob);
        fs.writeFileSync(outputPath, buffer);

        console.log(`✓ Сохранено: ${outputPath}`);
        await page.close();
        return { success: true, skipped: false };

    } catch (error) {
        console.error(`✗ Ошибка при конвертации ${jsonFilePath}:`, error.message);
        await page.close();
        return { success: false, error: error.message };
    }
}

// Главная функция
async function main() {
    console.log('=== Lottie to Video Batch Converter ===\n');
    console.log(`Папка с моделями: ${CONFIG.modelsDir}`);
    console.log(`Выходная папка: ${CONFIG.outputDir}`);
    console.log(`Кодек: ${CONFIG.codec}`);
    console.log(`Битрейт: ${CONFIG.bitrate} kbps\n`);

    // Получить все JSON файлы
    console.log('Сканирование файлов...');
    const jsonFiles = getAllJsonFiles(CONFIG.modelsDir);
    console.log(`Найдено файлов: ${jsonFiles.length}\n`);

    if (jsonFiles.length === 0) {
        console.log('Нет файлов для конвертации');
        return;
    }

    // Запустить браузер
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

    console.log('Браузер запущен\n');

    // Статистика
    let converted = 0;
    let skipped = 0;
    let failed = 0;

    // Конвертировать все файлы
    for (let i = 0; i < jsonFiles.length; i++) {
        const jsonFile = jsonFiles[i];
        console.log(`\n[${i + 1}/${jsonFiles.length}]`);

        const result = await convertFile(browser, jsonFile);

        if (result.success) {
            if (result.skipped) {
                skipped++;
            } else {
                converted++;
            }
        } else {
            failed++;
        }
    }

    // Закрыть браузер
    await browser.close();

    // Итоги
    console.log('\n=== Завершено ===');
    console.log(`Сконвертировано: ${converted}`);
    console.log(`Пропущено (уже существуют): ${skipped}`);
    console.log(`Ошибки: ${failed}`);
    console.log(`Всего обработано: ${jsonFiles.length}`);
}

// Запустить
main().catch(console.error);