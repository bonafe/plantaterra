// Estatística de uso (visitas/páginas) via Google Analytics — só depois de
// autorização explícita da pessoa. Dado de projeto/perímetro/curva de nível
// nunca passa por aqui (ver docs/especificacao.md secao 12): esse dado
// continua só no IndexedDB do aparelho, o script do GA não tem acesso a ele
// em nenhum lugar deste código. Consentimento em localStorage puro (não
// IndexedDB) porque é preferência de navegador, não dado de domínio — não
// precisa de migração de esquema nem de esperar nenhuma hidratação
// assíncrona de banco.

// Propriedade GA4 "Planta Terra" (fluxo web https://bonafe.github.io/plantaterra/,
// código de fluxo 15489380468).
const MEASUREMENT_ID = "G-JR0X3JBSER";

const CHAVE_CONSENTIMENTO = "plantaTerraConsentimentoAnalytics";

function lerConsentimento() {
    try {
        return window.localStorage.getItem(CHAVE_CONSENTIMENTO);
    } catch {
        return null; // Navegador com localStorage bloqueado (modo privado etc.) — trata como "ainda não respondeu", sem quebrar.
    }
}

function salvarConsentimento(valor) {
    try {
        window.localStorage.setItem(CHAVE_CONSENTIMENTO, valor);
    } catch {
        // Sem persistência: o banner volta a aparecer na próxima visita, mas o
        // app continua funcionando normalmente de qualquer forma.
    }
}

function carregarGoogleAnalytics() {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    function gtag() {
        window.dataLayer.push(arguments);
    }
    window.gtag = gtag;
    gtag("js", new Date());
    gtag("config", MEASUREMENT_ID);
}

function exibirBanner() {
    const banner = document.createElement("div");
    banner.className = "analytics-banner";
    banner.innerHTML = `
        <p>
            Podemos usar o Google Analytics pra saber quantas pessoas usam o
            PlantaTerra? Isso mede só visitas às telas — os projetos, perímetros
            e curvas de nível continuam 100% no seu aparelho, nunca passam por
            aqui.
        </p>
        <div class="analytics-banner-acoes">
            <button type="button" class="botao-primario" data-acao="aceitar">Aceitar</button>
            <button type="button" class="botao-secundario" data-acao="recusar">Recusar</button>
        </div>
    `;

    banner.querySelector('[data-acao="aceitar"]').addEventListener("click", () => {
        salvarConsentimento("aceito");
        carregarGoogleAnalytics();
        banner.remove();
    });

    banner.querySelector('[data-acao="recusar"]').addEventListener("click", () => {
        salvarConsentimento("recusado");
        banner.remove();
    });

    document.body.appendChild(banner);
}

const consentimento = lerConsentimento();
if (consentimento === "aceito") {
    carregarGoogleAnalytics();
} else if (consentimento !== "recusado") {
    exibirBanner();
}
