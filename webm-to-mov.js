const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');

const execPromise = util.promisify(exec);

// Конфигурация
const CONFIG = {
    inputDir: './output', // Папка с WebM файлами
    outputDir: './output_mov', // Папка для MOV файлов
    keepWebm: true, // Сохранить WebM файлы

    // ВЫБЕРИТЕ РЕЖИМ КОДИРОВАНИЯ:
    // 'qtrle' - QuickTime Animation (100% совместимость с After Effects, большие файлы)
    // 'prores' - ProRes 4444 (профессиональный, меньше размер, требует настройки в AE)
    mode: 'qtrle',

    // Настройки для ProRes (используются только если mode = 'prores')
    prores: {
        codec: 'prores_ks',
        profile: '4', // ProRes 4444
        pixelFormat: 'yuva444p10le',
        alphaBits: 16,
    },

    // Настройки для QuickTime Animation (используются если mode = 'qtrle')
    qtrle: {
        codec: 'qtrle',
        pixelFormat: 'yuva420p',
    }
};

// Проверить наличие FFmpeg
async function checkFFmpeg() {
    try {
        await execPromise('ffmpeg -version');
        return true;
    } catch (error) {
        return false;
    }
}

// Получить все WebM файлы рекурсивно
function getAllWebmFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);

    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            getAllWebmFiles(filePath, fileList);
        } else if (file.endsWith('.webm')) {
            fileList.push(filePath);
        }
    });

    return fileList;
}

// Конвертировать один файл
async function convertFile(webmPath) {
    // Создать путь для MOV файла
    const relativePath = path.relative(CONFIG.inputDir, webmPath);
    const movPath = path.join(CONFIG.outputDir, relativePath).replace('.webm', '.mov');

    // Создать папки для выходного файла
    const outputDir = path.dirname(movPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Если файл уже существует, пропустить
    if (fs.existsSync(movPath)) {
        return { success: true, skipped: true };
    }

    try {
        let command;

        if (CONFIG.mode === 'qtrle') {
            // QuickTime Animation - максимальная совместимость с After Effects
            // Использует явный декодер libvpx-vp9 для правильного чтения WebM с альфа-каналом
            command = `ffmpeg -vcodec libvpx-vp9 -i "${webmPath}" -c:v ${CONFIG.qtrle.codec} -pix_fmt ${CONFIG.qtrle.pixelFormat} -y "${movPath}"`;
        } else if (CONFIG.mode === 'prores') {
            // ProRes 4444 - профессиональный кодек с меньшим размером файла
            const cfg = CONFIG.prores;
            command = `ffmpeg -i "${webmPath}" -c:v ${cfg.codec} -profile:v ${cfg.profile} -pix_fmt ${cfg.pixelFormat} -alpha_bits ${cfg.alphaBits} -vendor apl0 -y "${movPath}"`;
        } else {
            throw new Error(`Неизвестный режим: ${CONFIG.mode}`);
        }

        await execPromise(command, { maxBuffer: 1024 * 1024 * 10 });

        return { success: true, skipped: false, outputPath: movPath };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Получить размер файла в MB
function getFileSizeMB(filePath) {
    const stats = fs.statSync(filePath);
    return (stats.size / (1024 * 1024)).toFixed(2);
}

// Главная функция
async function main() {
    console.log('=== WebM to MOV Converter (с сохранением прозрачности) ===\n');

    // Проверить FFmpeg
    console.log('Проверка FFmpeg...');
    const hasFFmpeg = await checkFFmpeg();

    if (!hasFFmpeg) {
        console.error('\n❌ ОШИБКА: FFmpeg не установлен!');
        console.error('\nУстановите FFmpeg:');
        console.error('  Windows: https://www.gyan.dev/ffmpeg/builds/');
        console.error('  или: choco install ffmpeg');
        console.error('  или: winget install ffmpeg');
        console.error('\nПосле установки перезапустите скрипт.');
        process.exit(1);
    }

    console.log('✓ FFmpeg найден\n');

    // Создать выходную папку
    if (!fs.existsSync(CONFIG.outputDir)) {
        fs.mkdirSync(CONFIG.outputDir, { recursive: true });
    }

    console.log(`Входная папка: ${CONFIG.inputDir}`);
    console.log(`Выходная папка: ${CONFIG.outputDir}`);

    if (CONFIG.mode === 'qtrle') {
        console.log(`Режим: QuickTime Animation (qtrle)`);
        console.log(`Формат: ${CONFIG.qtrle.pixelFormat}`);
        console.log(`Особенности: Максимальная совместимость с After Effects, большие файлы\n`);
    } else if (CONFIG.mode === 'prores') {
        console.log(`Режим: ProRes 4444 (профиль ${CONFIG.prores.profile})`);
        console.log(`Формат: ${CONFIG.prores.pixelFormat}, альфа: ${CONFIG.prores.alphaBits}-bit`);
        console.log(`Особенности: Профессиональный кодек, меньший размер файла\n`);
    }

    // Получить все WebM файлы
    console.log('Сканирование WebM файлов...');
    const webmFiles = getAllWebmFiles(CONFIG.inputDir);
    console.log(`Найдено файлов: ${webmFiles.length}\n`);

    if (webmFiles.length === 0) {
        console.log('Нет файлов для конвертации');
        return;
    }

    // Статистика
    let converted = 0;
    let skipped = 0;
    let failed = 0;
    let totalWebmSize = 0;
    let totalMovSize = 0;

    const startTime = Date.now();

    // Конвертировать все файлы
    console.log('Начинаем конвертацию:\n');

    for (let i = 0; i < webmFiles.length; i++) {
        const webmFile = webmFiles[i];
        const relativePath = path.relative(CONFIG.inputDir, webmFile);

        console.log(`[${i + 1}/${webmFiles.length}] ${relativePath}`);

        const webmSize = getFileSizeMB(webmFile);
        totalWebmSize += parseFloat(webmSize);

        const result = await convertFile(webmFile);

        if (result.success) {
            if (result.skipped) {
                console.log(`  ⏭  Пропущено (уже существует)\n`);
                skipped++;
            } else {
                const movSize = getFileSizeMB(result.outputPath);
                totalMovSize += parseFloat(movSize);
                console.log(`  ✓  ${webmSize} MB → ${movSize} MB\n`);
                converted++;
            }
        } else {
            console.error(`  ✗  Ошибка: ${result.error}\n`);
            failed++;
        }
    }

    const endTime = Date.now();
    const totalTime = ((endTime - startTime) / 1000).toFixed(2);
    const totalMinutes = (totalTime / 60).toFixed(2);

    // Итоги
    console.log('=== Завершено ===');
    console.log(`Сконвертировано: ${converted}`);
    console.log(`Пропущено (уже существуют): ${skipped}`);
    console.log(`Ошибки: ${failed}`);
    console.log(`Всего обработано: ${webmFiles.length}`);
    console.log(`Время выполнения: ${totalMinutes} минут (${totalTime}s)`);

    if (converted > 0) {
        const avgTime = (parseFloat(totalTime) / converted).toFixed(2);
        console.log(`Среднее время на файл: ${avgTime}s`);
        console.log(`\nРазмер WebM: ${totalWebmSize.toFixed(2)} MB`);
        console.log(`Размер MOV: ${totalMovSize.toFixed(2)} MB`);
        console.log(`Коэффициент: ${(totalMovSize / totalWebmSize).toFixed(2)}x`);
    }

    console.log(`\nМOV файлы сохранены в: ${CONFIG.outputDir}`);
}

// Запустить
main().catch(console.error);