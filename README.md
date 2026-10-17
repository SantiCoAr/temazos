# Temazos

Juego musical para el móvil con las reglas de **Hitster**: suena una canción, la colocas en tu línea del tiempo según el año en que salió y, si puedes, dices título y artista.

- Dos colecciones, cada una es un modo de juego aparte con su propia memoria de canciones ya escuchadas:
  - **Clásica**: 600 canciones, las 10 más escuchadas de cada año entre 1966 y 2025.
  - **Desde 2000**: 520 canciones, las más escuchadas hoy que salieron entre 2000 y 2025 (20 por año, como mucho 5 por artista).
- Años contrastados con las cartas oficiales de Hitster cuando coinciden.
- Modos Original, Pro, Experto y Cooperativo/solitario (3 vidas).
- Fichas: saltar canción (1), ¡Hitster! para retar (1) y comprar carta (3). Máximo 5.
- Las canciones que ya han salido no se repiten (tampoco entre partidas) hasta que se acaban o pulsas «Volver a poner todas». Cada colección lleva su propia cuenta.
- Todo se guarda en el propio navegador. No hay servidor ni cuentas.

## Música

Hay dos formas de que suene:

1. **Spotify Premium (recomendada).** La canción entera, desde el segundo 0 y sin anuncios. Suena en tu app de Spotify (móvil, altavoz u ordenador) y el juego la controla con Spotify Connect.
   Spotify exige una "app" de desarrollador propia (gratis, una sola vez):
   1. Entra en <https://developer.spotify.com/dashboard> y pulsa **Create app**.
   2. En **Redirect URIs** añade la dirección exacta del juego (por ejemplo `https://santicoar.github.io/temazos/`).
   3. Marca **Web API** y guarda.
   4. Copia el **Client ID** y pégalo en el juego. Pulsa **Conectar con Spotify**.
   5. Ten abierta la app de Spotify en algún dispositivo para que tenga dónde sonar.
2. **Sin cuenta.** Fragmentos de 30 s de iTunes (con Deezer de reserva). No hay que configurar nada, pero el fragmento suele empezar a mitad de canción.

## Archivos

- `index.html`, `css/style.css`: interfaz.
- `js/app.js`: lógica del juego y reproductores (Spotify / fragmentos).
- `js/songs.js`: la colección clásica `[año, título, artista, {alt, pref}]`.
- `js/songs2000.js`: la colección «Desde 2000», mismo formato.

Es una web estática: funciona en GitHub Pages, Vercel, Netlify o cualquier servidor de ficheros.
