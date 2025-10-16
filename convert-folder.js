const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Получить аргументы командной строки
const args = process.argv.slice(2);

if (args.length === 0) {
    console.log('Использование: node convert-folder.js <путь_к_папке> [опции]');
    console.log('\nПримеры:');
    console.log('  node convert-folder.js models/5167939598143193218');
    console.log('  node convert-folder.js models/5167939598143193218 --output=custom_output');
    console.log('  node convert-folder.js models/5167939598143193218 --codec=vp8');
    console.log('\nДоступные опции:');
    console.log('  --output=<папка>     Папка для сохранения видео (по умолчанию: ./output)');
    console.log('  --codec=<vp9|vp8>    Видео кодек (по умолчанию: vp9)');
    console.log('  --bitrate=<число>    Битрейт в kbps (по умолчанию: 5120)');
    console.log('  --speed=<число>      Скорость воспроизведения (по умолчанию: 1)');
    console.log('  --width=<число>      Ширина видео (по умолчанию: автоопределение)');
    console.log('  --height=<число>     Высота видео (по умолчанию: автоопределение)');
    process.exit(0);
}

const folderPath = args[0];

// Парсинг опций
const CONFIG = {
    modelsDir: folderPath,
    outputDir: './output',
    htmlPath: './convert-headless.html',
    codec: 'video/webm;codecs="vp9"', // VP9 с прозрачностью (альфа-канал)
    extension: '.webm',
    framerate: null,
    speed: 1,
    bitrate: 5120,
    width: null,
    height: null,
};

// Обработка аргументов
args.slice(1).forEach(arg => {
    if (arg.startsWith('--output=')) {
        CONFIG.outputDir = arg.substring(9);
    } else if (arg.startsWith('--codec=')) {
        const codec = arg.substring(8);
        if (codec === 'vp8') {
            CONFIG.codec = 'video/webm;codecs="vp8"';
        } else if (codec === 'vp9') {
            CONFIG.codec = 'video/webm;codecs="vp9"';
        }
    } else if (arg.startsWith('--bitrate=')) {
        CONFIG.bitrate = parseInt(arg.substring(10));
    } else if (arg.startsWith('--speed=')) {
        CONFIG.speed = parseFloat(arg.substring(8));
    } else if (arg.startsWith('--width=')) {
        CONFIG.width = parseInt(arg.substring(8));
    } else if (arg.startsWith('--height=')) {
        CONFIG.height = parseInt(arg.substring(9));
    }
});

// Проверить существование папки
if (!fs.existsSync(folderPath)) {
    console.error(`Ошибка: Папка "${folderPath}" не существует`);
    process.exit(1);
}

// Создать папку output если её нет
if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
}

// Получить все JSON файлы из папки
function getJsonFiles(dir) {
    const files = fs.readdirSync(dir);
    return files
        .filter(file => file.endsWith('.json'))
        .map(file => path.join(dir, file));
}

// Конвертировать один файл
async function convertFile(browser, jsonFilePath, basePath) {
    const page = await browser.newPage();

    try {
        // Получить относительный путь для создания структуры папок
        const relativePath = path.relative(basePath, jsonFilePath);
        const outputPath = path.join(CONFIG.outputDir, relativePath).replace('.json', CONFIG.extension);

        // Создать папки для выходного файла
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Если файл уже существует, пропустить
        if (fs.existsSync(outputPath)) {
            console.log(`  ⏭  Пропускаем (уже существует): ${path.basename(jsonFilePath)}`);
            await page.close();
            return { success: true, skipped: true };
        }

        console.log(`  🎬 Конвертируем: ${path.basename(jsonFilePath)}`);

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

        console.log(`  ✓  Сохранено: ${outputPath}`);
        await page.close();
        return { success: true, skipped: false };

    } catch (error) {
        console.error(`  ✗  Ошибка: ${error.message}`);
        await page.close();
        return { success: false, error: error.message };
    }
}

// Главная функция
async function main() {
    console.log('=== Lottie to Video - Конвертация папки ===\n');
    console.log(`Папка: ${folderPath}`);
    console.log(`Выходная папка: ${CONFIG.outputDir}`);
    console.log(`Кодек: ${CONFIG.codec}`);
    console.log(`Битрейт: ${CONFIG.bitrate} kbps\n`);

    // Получить все JSON файлы
    const jsonFiles = getJsonFiles(folderPath);
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
    console.log('Начинаем конвертацию:\n');

    // Статистика
    let converted = 0;
    let skipped = 0;
    let failed = 0;

    const startTime = Date.now();

    // Конвертировать все файлы
    for (let i = 0; i < jsonFiles.length; i++) {
        const jsonFile = jsonFiles[i];
        console.log(`[${i + 1}/${jsonFiles.length}]`);

        const result = await convertFile(browser, jsonFile, folderPath);

        if (result.success) {
            if (result.skipped) {
                skipped++;
            } else {
                converted++;
            }
        } else {
            failed++;
        }

        console.log('');
    }

    // Закрыть браузер
    await browser.close();

    const endTime = Date.now();
    const totalTime = ((endTime - startTime) / 1000).toFixed(2);

    // Итоги
    console.log('=== Завершено ===');
    console.log(`Сконвертировано: ${converted}`);
    console.log(`Пропущено (уже существуют): ${skipped}`);
    console.log(`Ошибки: ${failed}`);
    console.log(`Всего обработано: ${jsonFiles.length}`);
    console.log(`Время выполнения: ${totalTime}s`);

    if (converted > 0) {
        const avgTime = (parseFloat(totalTime) / converted).toFixed(2);
        console.log(`Среднее время на файл: ${avgTime}s`);
    }
}

// Запустить
main().catch(console.error);