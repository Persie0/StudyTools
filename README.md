# PDF Page Stripper

Remove pages from incrementally built slides, keeping only the final/complete ones.

[Live Demo](https://persie0.github.io/PDF-Page-Stripper/)

<img src="images/screenshot.jpg" alt="PDF Page Stripper Screenshot" style="width: 600px; cursor: pointer;" onclick="window.open('https://persie0.github.io/PDF-Page-Stripper/')">

## Example
The upper slide would get removed.


<img src="images/example.jpg" alt="PDF Page Stripper Example" style="width: 370px; cursor: pointer;">

## How It Works

1. Extracts text from each page of the PDFs.
2. Compares each page with the one before it.
3. Removes the previous page if the current one contains all its text.
4. Retains only the relevant, non-duplicate pages in the final PDFs.

## Comparison Mode:
  - **Word Comparison**: Strips more pages by comparing at the word level.
  - **Full Text Comparison**: Strips fewer pages by comparing entire text of the page.
  
## Additional Features

- Process multiple PDFs simultaneously.
- Drag and drop support for easy file uploading.


## Inspiration

This project was inspired by [pdf-page-stripper](https://github.com/fsinf/pdf-page-stripper), which I highly recommend for any tasks other than removing incrementally built slides.
