const { prisma } = require('./client');
const templatesRouter = require('../routes/templates.routes');

async function seedTemplates() {
  const templates = Array.isArray(templatesRouter.TEMPLATES) ? templatesRouter.TEMPLATES : [];

  for (const template of templates) {
    await prisma.template.upsert({
      where: { id: String(template.id) },
      update: {
        title: String(template.title || ''),
        description: String(template.description || ''),
        icon: String(template.icon || ''),
        content: String(template.content || ''),
      },
      create: {
        id: String(template.id),
        title: String(template.title || ''),
        description: String(template.description || ''),
        icon: String(template.icon || ''),
        content: String(template.content || ''),
      },
    });
  }

  const count = await prisma.template.count();
  console.log(`Templates seeded. Total templates: ${count}`);
}

seedTemplates()
  .catch((error) => {
    console.error('Failed to seed templates:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
