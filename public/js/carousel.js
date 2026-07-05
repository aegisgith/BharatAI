/**
 * SPEAKERS CAROUSEL
 * Universal carousel handler for multiple scrolling carousels with auto-rotation
 */

function initSpeakersCarousel() {
    // Handle confirmed speakers carousel
    initCarousel('speakersCarousel', 'speakersCarouselPrev', 'speakersCarouselNext');
    
    // Handle all past speakers carousels by data attribute
    const pastCarousels = document.querySelectorAll('[data-carousel^="pastSpeakers-"]');
    pastCarousels.forEach(carousel => {
        const carouselId = carousel.getAttribute('data-carousel');
        // Find buttons with matching data-carousel-target
        const prevBtn = document.querySelector(`[data-carousel-target="${carouselId}"].carousel-prev`);
        const nextBtn = document.querySelector(`[data-carousel-target="${carouselId}"].carousel-next`);
        if (carousel && prevBtn && nextBtn) {
            initCarousel(carousel, prevBtn, nextBtn);
        }
    });
}

function initCarousel(carousel, prevBtn, nextBtn) {
    // Allow both string IDs and DOM elements
    if (typeof carousel === 'string') {
        carousel = document.getElementById(carousel);
    }
    if (typeof prevBtn === 'string') {
        prevBtn = document.getElementById(prevBtn);
    }
    if (typeof nextBtn === 'string') {
        nextBtn = document.getElementById(nextBtn);
    }

    if (!carousel || !prevBtn || !nextBtn) return;

    const scrollAmount = 270; // Card width (250px) + gap (1.5rem = 20px)
    const autoScrollInterval = 4000; // Auto-scroll every 4 seconds
    let autoScrollTimer = null;
    let isUserInteracting = false;

    // Start auto-rotation
    function startAutoScroll() {
        if (autoScrollTimer) clearInterval(autoScrollTimer);
        
        autoScrollTimer = setInterval(() => {
            const scrollLeft = carousel.scrollLeft;
            const scrollWidth = carousel.scrollWidth;
            const clientWidth = carousel.clientWidth;

            // Reset to beginning if at end
            if (scrollLeft >= scrollWidth - clientWidth - 10) {
                carousel.scrollTo({
                    left: 0,
                    behavior: 'smooth'
                });
            } else {
                carousel.scrollBy({
                    left: scrollAmount,
                    behavior: 'smooth'
                });
            }
        }, autoScrollInterval);
    }

    // Stop auto-rotation
    function stopAutoScroll() {
        if (autoScrollTimer) {
            clearInterval(autoScrollTimer);
            autoScrollTimer = null;
        }
    }

    // Resume auto-scroll after user interaction
    function resumeAutoScroll() {
        stopAutoScroll();
        setTimeout(() => {
            startAutoScroll();
        }, 2000); // Resume after 2 seconds of inactivity
    }

    // Scroll left
    prevBtn.addEventListener('click', () => {
        isUserInteracting = true;
        carousel.scrollBy({
            left: -scrollAmount,
            behavior: 'smooth'
        });
        resumeAutoScroll();
    });

    // Scroll right
    nextBtn.addEventListener('click', () => {
        isUserInteracting = true;
        carousel.scrollBy({
            left: scrollAmount,
            behavior: 'smooth'
        });
        resumeAutoScroll();
    });

    // Pause auto-scroll on manual scroll
    let scrollTimeout;
    carousel.addEventListener('scroll', () => {
        stopAutoScroll();
        
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            isUserInteracting = false;
            startAutoScroll();
        }, 2000); // Resume after 2 seconds of manual scroll
    });

    // Update button states on scroll
    function updateButtonStates() {
        const scrollLeft = carousel.scrollLeft;
        const scrollWidth = carousel.scrollWidth;
        const clientWidth = carousel.clientWidth;

        // Disable prev button at start
        prevBtn.disabled = scrollLeft <= 0;
        
        // Disable next button at end
        nextBtn.disabled = scrollLeft >= scrollWidth - clientWidth - 10;
    }

    // Initial state
    updateButtonStates();

    // Update on scroll
    carousel.addEventListener('scroll', updateButtonStates);

    // Update on window resize
    window.addEventListener('resize', updateButtonStates);

    // Start auto-rotation on load
    startAutoScroll();

    // Pause when user hovers over carousel
    carousel.addEventListener('mouseenter', stopAutoScroll);
    carousel.addEventListener('mouseleave', startAutoScroll);
}
