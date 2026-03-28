// ❌ НЕПРАВИЛЬНО (мой новый синтаксис):
ai.models.generateContent(modelName, { contents: [{ role: "user", parts: [{ text: prompt }] }] })

// ✅ ПРАВИЛЬНО (старый рабочий):
ai.models.generateContent({
  model: modelName,
  contents: prompt,
  config: {}
})
