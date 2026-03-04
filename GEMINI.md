# GEMINI.md - Instructional Context

## Project Overview
This project is a single-page static website serving as a digital invitation for the wedding ("Shubha Vivaha") of Greeshma and Vijesh. It features a traditional Indian aesthetic with custom typography, animations, and background music.

### Main Technologies
- **HTML5**: Core structure and content.
- **CSS3**: Extensive styling using CSS variables, flexbox, and keyframe animations.
- **JavaScript (Vanilla)**: Interactive elements, including mouse-tracking transformations.
- **Google Fonts**: Utilizes `Cormorant Garamond`, `Cinzel`, `Tiro Devanagari Sanskrit`, and `Jost`.
- **Assets**: Includes `tulasi.mp3` for background audio.

## Architecture
- `index.html`: The main entry point containing the bulk of the content, inline styles for the wedding theme, and structural elements.
- `styles.css`: External stylesheet providing additional layout and typography for specific interactive components.
- `app.js`: JavaScript logic for handling mouse movement effects and window resizing.
- `CNAME`: Configuration for custom domain mapping (likely for GitHub Pages).

## Building and Running
As this is a static website, there is no build process required.

### Key Commands
- **Run Locally**: Open `index.html` in any modern web browser.
- **Development**: Use a simple live-reloading server like `live-server` or the VS Code Live Server extension for real-time previews.
- **Testing**: Manual verification across different screen sizes (mobile responsiveness is handled via CSS).

## Development Conventions
- **Styling**: Prefer updating CSS variables in `:root` within `index.html` for theme-wide changes (colors like `--cream`, `--crimson`, `--saffron`).
- **Animations**: Many animations are defined as CSS keyframes within `index.html`.
- **Interactivity**: Mouse-based parallax/skew effects are managed in `app.js`.
