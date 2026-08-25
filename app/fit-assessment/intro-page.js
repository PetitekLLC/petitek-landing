(function(){
  'use strict';
  const cards=[...document.querySelectorAll('.fit-pet-card')];
  const nameInput=document.getElementById('fit-pet-name');
  const continueBtn=document.getElementById('fit-continue');
  let selectedPet='dog';

  function update(){
    cards.forEach(card=>{
      const selected=card.dataset.pet===selectedPet;
      card.classList.toggle('is-selected',selected);
      card.setAttribute('aria-pressed',String(selected));
    });
    continueBtn.disabled=!selectedPet || !nameInput.value.trim();
  }

  cards.forEach(card=>card.addEventListener('click',()=>{
    selectedPet=card.dataset.pet;
    update();
  }));

  nameInput.addEventListener('input',update);
  nameInput.addEventListener('keydown',event=>{
    if(event.key==='Enter' && !continueBtn.disabled) continueBtn.click();
  });

  continueBtn.addEventListener('click',()=>{
    if(continueBtn.disabled) return;
    const detail={petType:selectedPet,petName:nameInput.value.trim()};
    window.dispatchEvent(new CustomEvent('chatrbox:fit-intro-complete',{detail}));
    if(window.ChatrBoxFitAssessment && typeof window.ChatrBoxFitAssessment.start==='function'){
      window.ChatrBoxFitAssessment.start(detail);
    }
  });

  update();
})();
