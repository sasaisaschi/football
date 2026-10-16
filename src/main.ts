import './main.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app element missing in index.html');
app.textContent = 'THE 12TH MAN';
