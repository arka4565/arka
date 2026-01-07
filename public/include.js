async function loadHTML() {
    // 1. data-include 속성을 가진 모든 요소를 찾음
    const elements = document.querySelectorAll('[data-include]');

    for (let el of elements) {
        const file = el.getAttribute('data-include');
        try {
            // 2. 해당 파일 내용을 가져옴
            const res = await fetch(file);
            if (res.ok) {
                const html = await res.text();
                el.innerHTML = html;
                
                // 3. 네비게이션이 로드된 후 '현재 페이지' 활성화 처리
                if (file.includes('nav.html')) {
                    highlightActiveMenu();
                    updateLinksWithSettingId();
                }
            } else {
                el.innerHTML = 'Page not found.';
            }
        } catch (e) {
            console.error('Include error:', e);
        }
    }
}

// 현재 URL에 해당하는 메뉴에 'active' 클래스 추가
function highlightActiveMenu() {
    const path = window.location.pathname; // 예: '/write.html'
    const page = path.split("/").pop() || 'index.html'; // 파일명 추출

    // 모든 nav-item에서 active 제거
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));

    // 현재 페이지와 매칭되는 링크 찾기 (href 속성 활용)
    // 예: <a href="write.html" ...>
    const activeLink = document.querySelector(`.nav-item[href^="${page}"]`);
    if (activeLink) {
        activeLink.classList.add('active');
    }
}

// URL 파라미터(setting_id) 유지하기
function updateLinksWithSettingId() {
    const urlParams = new URLSearchParams(window.location.search);
    const settingId = urlParams.get('setting_id');

    if (settingId) {
        document.querySelectorAll('.nav-item').forEach(item => {
            const href = item.getAttribute('href');
            // 자바스크립트 링크나 이미 파라미터가 있는 경우 제외
            if (href && !href.startsWith('javascript') && !href.includes('setting_id')) {
                item.setAttribute('href', `${href}?setting_id=${settingId}`);
            }
        });
    }
}

// 페이지 로드 시 실행
document.addEventListener('DOMContentLoaded', loadHTML);