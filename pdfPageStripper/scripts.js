// scripts.js
 
import * as pdfjsLib from './lib/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.min.mjs';

const fileInput = document.getElementById('fileInput');
const downloadBtn = document.getElementById('downloadBtn');
const progressBar = document.querySelector('.progress-bar');
const progress = document.querySelector('.progress');
const pdfCreationStatus = document.getElementById('pdfCreationStatus');

let processedPDFs = [];

async function processFiles() {
    const files = fileInput.files;
    if (files.length === 0) {
        alert('Please select at least one PDF file.');
        return;
    }

    progressBar.style.display = 'block';
    downloadBtn.style.display = 'none';
    pdfCreationStatus.textContent = 'Processing PDFs...';

    processedPDFs = [];
    let outputHtml = '';

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const result = await processPDF(file);
        processedPDFs.push({ name: `stripped_${file.name}`, pdf: result.pdf });
        outputHtml += result.html;

        progress.style.width = `${((i + 1) / files.length) * 100}%`;
    }

    document.getElementById('output').innerHTML = outputHtml;
    progress.style.width = '0%';
    progressBar.style.display = 'none';
    pdfCreationStatus.textContent = 'All PDFs processed successfully!';
    downloadBtn.style.display = 'inline-block';
}

async function processPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
    const numPages = pdf.numPages;
    let pagesToKeep = [];
    let allPages = [];

    const wordComparisonMode = document.getElementById('wordComparisonMode').checked;

    function getWords(text) {
        return text.toLowerCase().match(/\b\w+\b/g) || [];
    }

    function includesAllWords(newText, existingText) {
        const newWords = new Set(getWords(newText));
        const existingWords = new Set(getWords(existingText));
        for (let word of existingWords) {
            if (!newWords.has(word)) {
                return false;
            }
        }
        return true;
    }

    function includesContent(currentText, previousText) {
        const currentWords = new Set(currentText.toLowerCase().split(/\s+/));
        const previousWords = new Set(previousText.toLowerCase().split(/\s+/));
        for (let word of previousWords) {
            if (!currentWords.has(word)) {
                return false;
            }
        }
        return true;
    }

    for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        allPages.push({ pageNumber: i, text: pageText });
        
        if (pagesToKeep.length === 0 || 
            (wordComparisonMode && !includesAllWords(pageText, pagesToKeep[pagesToKeep.length - 1].text)) ||
            (!wordComparisonMode && !includesContent(pageText, pagesToKeep[pagesToKeep.length - 1].text))) {
            pagesToKeep.push({ pageNumber: i, text: pageText });
        } else {
            pagesToKeep.pop();
            pagesToKeep.push({ pageNumber: i, text: pageText });
        }

        // Update progress more frequently
        updateProgress(file.name, i, numPages);
    }

    const processedPDF = await createProcessedPDF(file, pagesToKeep);
    const html = displayResults(file.name, pagesToKeep, allPages);
    return { pdf: processedPDF, html: html };
}

function updateProgress(fileName, currentPage, totalPages) {
    const percentage = Math.round((currentPage / totalPages) * 100);
    pdfCreationStatus.textContent = `Processing ${fileName}: ${percentage}% (Page ${currentPage}/${totalPages})`;
    progress.style.width = `${percentage}%`;
}

function displayResults(fileName, pagesToKeep, allPages) {
    const keptPageNumbers = new Set(pagesToKeep.map(p => p.pageNumber));
    const removedPages = allPages.length - pagesToKeep.length;
    const comparisonMode = document.getElementById('wordComparisonMode').checked ? 'Word' : 'Full text';
    
    let html = `<h2>${fileName}</h2>`;
    html += `
        <div class="results-summary">
            <div>
                <h3>Total Pages</h3>
                <p>${allPages.length}</p>
            </div>
            <div>
                <h3>Pages Kept</h3>
                <p>${pagesToKeep.length}</p>
            </div>
            <div>
                <h3>Pages Removed</h3>
                <p>${removedPages}</p>
            </div>
            <div>
                <h3>Comparison Mode</h3>
                <p>${comparisonMode}</p>
            </div>
        </div>
    `;
    html += `<h3>Page breakdown:</h3>`;
    html += `<div class="pages-list">`;
    for (let page of allPages) {
        const chipClass = keptPageNumbers.has(page.pageNumber) ? 'page-kept' : 'page-removed';
        html += `<span class="page-chip ${chipClass}">Page ${page.pageNumber}</span>`;
    }
    html += `</div>`;
    
    return html;
}

// Add this to your existing scripts.js file

async function createProcessedPDF(file, pagesToKeep) {
    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
    const newPdfDoc = await PDFLib.PDFDocument.create();

    const compressPDF = document.getElementById('compressPDF').checked;

    for (let i = 0; i < pagesToKeep.length; i++) {
        const page = pagesToKeep[i];
        const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [page.pageNumber - 1]);
        newPdfDoc.addPage(copiedPage);

        // Update progress
        updateCreationProgress(file.name, i + 1, pagesToKeep.length);
    }

    // Final status update before saving
    pdfCreationStatus.textContent = `Finalizing ${file.name}...`;
    
    let pdfBytes;
    if (compressPDF) {
        pdfBytes = await newPdfDoc.save({
            useObjectStreams: true,
            addDefaultPage: false,
            objectsPerTick: 50,
            updateFieldAppearances: false,
        });
    } else {
        pdfBytes = await newPdfDoc.save();
    }

    return pdfBytes;
}

// Update the initCheckboxState function to include the new checkbox
function initCheckboxState() {
    const wordComparisonCheckbox = document.getElementById('wordComparisonMode');
    const compressPDFCheckbox = document.getElementById('compressPDF');
    
    const savedWordComparisonState = getCookie('wordComparisonMode');
    const savedCompressPDFState = getCookie('compressPDF');
    
    if (savedWordComparisonState === 'true') {
        wordComparisonCheckbox.checked = true;
    } else {
        wordComparisonCheckbox.checked = false;
    }

    if (savedCompressPDFState === 'false') {
        compressPDFCheckbox.checked = false;
    } else {
        compressPDFCheckbox.checked = true;
    }

    wordComparisonCheckbox.addEventListener('change', function() {
        setCookie('wordComparisonMode', this.checked, 30); // Save for 30 days
    });

    compressPDFCheckbox.addEventListener('change', function() {
        setCookie('compressPDF', this.checked, 30); // Save for 30 days
    });
}

// Make sure to call initCheckboxState() when the page loads
document.addEventListener('DOMContentLoaded', initCheckboxState);

function updateCreationProgress(fileName, currentPage, totalPages) {
    const percentage = Math.round((currentPage / totalPages) * 100);
    pdfCreationStatus.textContent = `Creating new PDF for ${fileName}: ${percentage}% (Page ${currentPage}/${totalPages})`;
    progress.style.width = `${percentage}%`;
}

async function downloadProcessedPDFs() {
    if (processedPDFs.length === 1) {
        pdfCreationStatus.textContent = 'Creating PDF...';
        await new Promise(resolve => setTimeout(resolve, 100));
        const pdfFile = processedPDFs[0];
        download(pdfFile.pdf, pdfFile.name, 'application/pdf');
        pdfCreationStatus.textContent = 'PDF downloaded successfully!';
    } else {
        pdfCreationStatus.textContent = 'Creating ZIP file...';
        await new Promise(resolve => setTimeout(resolve, 100));
        const zip = new JSZip();

        for (const pdfFile of processedPDFs) {
            zip.file(pdfFile.name, pdfFile.pdf);
        }

        const content = await zip.generateAsync({ type: 'blob' });
        download(content, 'processed_pdfs.zip', 'application/zip');
        pdfCreationStatus.textContent = 'ZIP file downloaded successfully!';
    }
}

function showInfo() {
    document.getElementById('infoModal').style.display = 'block';
}

function closeInfo() {
    document.getElementById('infoModal').style.display = 'none';
}

// Initialize drag and drop functionality
document.addEventListener('DOMContentLoaded', setupDragAndDrop);

// Function to set a cookie
function setCookie(name, value, days) {
    let expires = "";
    if (days) {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = "; expires=" + date.toUTCString();
    }
    document.cookie = name + "=" + (value || "")  + expires + "; path=/";
}

// Function to get a cookie
function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for(let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) == ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}


// Call this function when the page loads
document.addEventListener('DOMContentLoaded', initCheckboxState);

// Add this to your scripts.js file

function setupDragAndDrop() {
    const dropZone = document.body;
    const fileInput = document.getElementById('fileInput');

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, unhighlight, false);
    });

    function highlight() {
        dropZone.classList.add('highlight');
    }

    function unhighlight() {
        dropZone.classList.remove('highlight');
    }

    dropZone.addEventListener('drop', handleDrop, false);

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        fileInput.files = files;
    }
}

// Call this function when the page loads
document.addEventListener('DOMContentLoaded', setupDragAndDrop);

// Export the functions that need to be accessible globally
window.processFiles = processFiles;
window.downloadProcessedPDFs = downloadProcessedPDFs;
window.showInfo = showInfo;
window.closeInfo = closeInfo;