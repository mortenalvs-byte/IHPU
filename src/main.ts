import './styles/app.css';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('Missing #app root element');
}

root.innerHTML = `
  <header class="app-header">
    <h1>IHPU TrykkAnalyse</h1>
    <p class="subtitle">Trykktestanalyse — desktop</p>
  </header>
  <main class="app-main">
    <section class="status-panel">
      <p class="status">Ingen data lastet</p>
      <div class="upload-zone" aria-disabled="true">
        <p>Filopplasting kommer i neste iterasjon.</p>
        <input type="file" disabled />
      </div>
    </section>
    <p class="bootstrap-ok"><strong>Bootstrap OK</strong></p>
  </main>
`;
