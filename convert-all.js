const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

// Конфигурация
const CONFIG = {
    modelsDir: './models',
    outputDir: './output_mov', // Сразу в MOV!
    tempDir: './temp_frames',
    htmlPath: './convert-headless.html',
    extension: '.mov',
    framerate: null, // null = autodetect
    speed: 1,
    width: null,
    height: null,

    // MOV кодек
    // 'png' - PNG кодек (правильные цвета!) ✅ РЕКОМЕНДУЕТСЯ
    // 'qtrle' - QuickTime Animation (проблемы с цветами)
    // 'prores' - ProRes 4444
    movCodec: 'png',
};

// Создать папки
if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
}

if (!fs.existsSync(CONFIG.tempDir)) {
    fs.mkdirSync(CONFIG.tempDir, { recursive: true });
}

// Получить все JSON файлы
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

// Конвертировать PNG frames в MOV через FFmpeg
async function convertPngToMov(framesDir, outputPath, fps) {
    const absFramesDir = path.resolve(framesDir).replace(/\\/g, '/');
    const absOutputPath = path.resolve(outputPath).replace(/\\/g, '/');
    const framePattern = `${absFramesDir}/frame_%05d.png`;

    let command;
    if (CONFIG.movCodec === 'qtrle') {
        // QuickTime Animation - НЕ РАБОТАЕТ КОРРЕКТНО С ЦВЕТАМИ
        command = `ffmpeg -framerate ${fps} -i "${framePattern}" -c:v qtrle -pix_fmt argb -y "${absOutputPath}"`;
    } else if (CONFIG.movCodec === 'png') {
        // PNG кодек - ПРАВИЛЬНЫЕ ЦВЕТА! ✅
        command = `ffmpeg -framerate ${fps} -i "${framePattern}" -c:v png -pix_fmt rgba -y "${absOutputPath}"`;
    } else {
        // ProRes 4444
        command = `ffmpeg -framerate ${fps} -i "${framePattern}" -c:v prores_ks -profile:v 4 -pix_fmt yuva444p10le -alpha_bits 16 -vendor apl0 -y "${absOutputPath}"`;
    }

    await execPromise(command, { maxBuffer: 1024 * 1024 * 50 });
}

// Очистить временную папку
function cleanTempDir(dir) {
    if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            fs.unlinkSync(path.join(dir, file));
        });
        fs.rmdirSync(dir);
    }
}

// Конвертировать data URL в файл
function dataUrlToFile(dataUrl, filePath) {
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);
}

// Конвертировать один файл
async function convertFile(browser, jsonFilePath) {
    const page = await browser.newPage();

    try {
        const relativePath = path.relative(CONFIG.modelsDir, jsonFilePath);
        const decodedPath = decodeURIComponent(relativePath);
        const outputPath = path.join(CONFIG.outputDir, decodedPath).replace('.json', CONFIG.extension);

        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        if (fs.existsSync(outputPath)) {
            console.log(`⏭  Пропускаем (уже существует): ${relativePath}`);
            await page.close();
            return { success: true, skipped: true };
        }

        console.log(`🎬 Конвертируем: ${relativePath}`);

        const htmlUrl = 'file:///' + path.resolve(CONFIG.htmlPath).replace(/\\/g, '/');
        await page.goto(htmlUrl, { waitForTimeout: 2000 });
        await page.waitForFunction(() => window.converterReady === true, { timeout: 10000 });

        const jsonContent = fs.readFileSync(jsonFilePath, 'utf8');
        const jsonData = JSON.parse(jsonContent);

        console.log(`  📸 Рендеринг SVG → PNG кадров...`);

        const result = await page.evaluate(async(jsonData, options) => {
            try {
                return await window.convertLottieToVideo(jsonData, options);
            } catch (error) {
                return { success: false, error: error.message };
            }
        }, jsonData, {
            width: CONFIG.width,
            height: CONFIG.height,
            framerate: CONFIG.framerate,
            speed: CONFIG.speed,
        });

        if (!result.success) {
            throw new Error(result.error);
        }

        // Создать временную папку для PNG кадров
        const baseFileName = decodeURIComponent(path.basename(jsonFilePath, '.json'));
        const safeName = baseFileName.replace(/[<>:"|?*]/g, '_');
        const tempFramesDir = path.join(CONFIG.tempDir, safeName + '_' + Date.now());
        fs.mkdirSync(tempFramesDir, { recursive: true });

        console.log(`  💾 Сохранение ${result.frames.length} PNG кадров...`);

        // Сохранить все PNG кадры
        for (let i = 0; i < result.frames.length; i++) {
            const paddedIndex = String(i).padStart(5, '0');
            const framePath = path.join(tempFramesDir, `frame_${paddedIndex}.png`);
            dataUrlToFile(result.frames[i], framePath);
        }

        const createdFiles = fs.readdirSync(tempFramesDir).filter(f => f.endsWith('.png'));
        if (createdFiles.length === 0) {
            throw new Error(`PNG кадры не были созданы`);
        }
        console.log(`  ✓ ${createdFiles.length} PNG кадров сохранены`);

        console.log(`  🎥 Сборка MOV (${result.fps} fps, ${CONFIG.movCodec})...`);

        // Собрать PNG в MOV через FFmpeg
        await convertPngToMov(tempFramesDir, outputPath, result.fps);

        // Очистить временные файлы
        cleanTempDir(tempFramesDir);

        console.log(`  ✅ Готово: ${outputPath}\n`);
        await page.close();
        return { success: true, skipped: false };

    } catch (error) {
        console.error(`  ❌ Ошибка: ${error.message}\n`);
        await page.close();
        return { success: false, error: error.message };
    }
}

// Главная функция
async function main() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║  Lottie → MOV Converter (SVG рендерер + PNG sequence)     ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log(`📁 Входная папка: ${CONFIG.modelsDir}`);
    console.log(`📁 Выходная папка: ${CONFIG.outputDir}`);
    console.log(`🎨 Рендерер: SVG (качественные градиенты)`);
    console.log(`🎬 Кодек: ${CONFIG.movCodec === 'png' ? 'PNG (правильные цвета!)' : CONFIG.movCodec === 'qtrle' ? 'QuickTime Animation (qtrle)' : 'ProRes 4444'}`);
    console.log(`💾 Формат: MOV с прозрачностью\n`);

    // Проверить FFmpeg
    console.log('🔍 Проверка FFmpeg...');
    try {
        await execPromise('ffmpeg -version');
        console.log('✅ FFmpeg найден\n');
    } catch (error) {
        console.error('\n❌ ОШИБКА: FFmpeg не установлен!');
        console.error('Установите FFmpeg: https://www.gyan.dev/ffmpeg/builds/\n');
        process.exit(1);
    }

    console.log('🔍 Сканирование Lottie файлов...');
    const jsonFiles = getAllJsonFiles(CONFIG.modelsDir);
    console.log(`📊 Найдено файлов: ${jsonFiles.length}\n`);

    if (jsonFiles.length === 0) {
        console.log('❌ Нет файлов для конвертации');
        return;
    }

    console.log('🌐 Запуск headless браузера...');
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
        ],
    });
    console.log('✅ Браузер запущен\n');
    console.log('═══════════════════════════════════════════════════════════\n');

    let converted = 0;
    let skipped = 0;
    let failed = 0;
    const startTime = Date.now();

    for (let i = 0; i < jsonFiles.length; i++) {
        const jsonFile = jsonFiles[i];
        console.log(`[${i + 1}/${jsonFiles.length}]`);

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

    await browser.close();

    // Очистить temp_frames если пустая
    if (fs.existsSync(CONFIG.tempDir)) {
        const tempContents = fs.readdirSync(CONFIG.tempDir);
        if (tempContents.length === 0) {
            fs.rmdirSync(CONFIG.tempDir);
        }
    }

    const endTime = Date.now();
    const totalTime = ((endTime - startTime) / 1000).toFixed(2);
    const totalMinutes = (totalTime / 60).toFixed(2);

    console.log('═══════════════════════════════════════════════════════════');
    console.log('                      ЗАВЕРШЕНО                            ');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log(`✅ Сконвертировано: ${converted}`);
    console.log(`⏭  Пропущено (уже существуют): ${skipped}`);
    console.log(`❌ Ошибки: ${failed}`);
    console.log(`📊 Всего обработано: ${jsonFiles.length}`);
    console.log(`⏱  Время выполнения: ${totalMinutes} мин (${totalTime}s)`);

    if (converted > 0) {
        const avgTime = (parseFloat(totalTime) / converted).toFixed(2);
        console.log(`📈 Среднее время на файл: ${avgTime}s`);
    }

    console.log(`\n📁 MOV файлы готовы в: ${CONFIG.outputDir}`);
    console.log(`🎨 Рендерер: ✅ SVG (без искажений)`);
    console.log(`🎬 FFmpeg: ✅ PNG кодек (правильные цвета!)`);
    console.log(`💎 Прозрачность: ✅`);
    console.log(`\n🎉 Готово для импорта в After Effects!`);
}

main().catch(console.error);