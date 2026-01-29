document.addEventListener("DOMContentLoaded", () => {
  initializeFAQ();
});
function initializeFAQ() {
  const questions = document.querySelectorAll(".faq-question .faq-item");

  questions.forEach((question) => {
    question.addEventListener("click", () => {
      const faqItem = question.closest(".faq-item");
      const icon = question.querySelector(".faq-icon");

      if (!faqItem || !icon) return;

      faqItem.classList.toggle("active");
    });
  });
}
