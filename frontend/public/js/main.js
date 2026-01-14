// public/js/main.js

document.addEventListener("DOMContentLoaded", () => {
  initializeFAQ();
});

/**
 * FAQ accordion functionality
 * - Click question to toggle answer
 * - Icon switches between + and −
 */
function initializeFAQ() {
  const questions = document.querySelectorAll(".faq-question");

  questions.forEach((question) => {
    question.addEventListener("click", () => {
      const faqItem = question.closest(".faq-item");
      const icon = question.querySelector(".faq-icon");

      if (!faqItem || !icon) return;

      faqItem.classList.toggle("active");
      icon.textContent = faqItem.classList.contains("active") ? "−" : "+";
    });
  });
}
