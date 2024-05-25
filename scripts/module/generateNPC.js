import { CONSTANTS, isRequesting, npcGenGPTLib } from "./lib.js";
import { npcGenGPTDataStructure } from "./dataStructures.js";

export class npcGenGPTGenerateNPC extends Application {
    constructor() {
        super();
        this.data = {};
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            id: CONSTANTS.MODULE_ID,
            title: game.i18n.localize("npc-generator-gpt.dialog.title"),
            template: `modules/${CONSTANTS.MODULE_ID}/templates/${CONSTANTS.TEMPLATE.DIALOG}`,
            width: 300,
            height: 370
        });
    }

    async getData(options) {
        const data = await super.getData(options);
        const categories = npcGenGPTLib.getDialogCategories(npcGenGPTDataStructure.categoryList);
        data.category = categories.map(category => {
            const arg = (category.value === 'subtype') ? 'commoner' : category.value;
            return { ...category, option: npcGenGPTLib.getDialogOptions(arg, (arg !== 'type' && arg !== 'cr')) };
        });
        return data;
    }

    activateListeners(html) {
        super.activateListeners(html);
        html.find('#type').change(this.changeDialogCategory.bind(this));
        html.find('#npcGenGPT_create-btn').click(this.initGeneration.bind(this));
    }

    changeDialogCategory() {
        const npcType = this.element.find('#type option:selected').val();
        const generateOptions = (data, random) => {
            return npcGenGPTLib.getDialogOptions(data, random).map(subtype => {
                if (subtype.translate) subtype.label = game.i18n.localize(subtype.label);
                return `<option value="${subtype.value}">${subtype.label}</option>`;
            }).join('');
        };
        const label = game.i18n.localize(`npc-generator-gpt.dialog.subtype.${(npcType === 'npc') ? 'class' : 'label'}`);
        this.element.find("label[for='subtype']").text(`${label}:`);
        this.element.find("#subtype").html(generateOptions(npcType, true));
        this.element.find("#cr").html(generateOptions('cr', npcType === 'npc'));
    }

    async initGeneration() {
        if (isRequesting) {
            ui.notifications.warn(`${CONSTANTS.LOG_PREFIX} ${game.i18n.localize("npc-generator-gpt.status.wait")}`);
            return;
        }

        this.generateDialogData();

        const button = this.element.find('#npcGenGPT_create-btn');
        button.text(game.i18n.localize("npc-generator-gpt.dialog.buttonPending"));

        const responseData = await npcGenGPTLib.callAI(this.initQuery());

        button.text(game.i18n.localize("npc-generator-gpt.dialog.button"));

        if (responseData) {
            this.mergeGptData(responseData);
            this.createNPC();
        }
    }

    generateDialogData() {
        this.data.details = {};
        npcGenGPTDataStructure.categoryList.forEach(category => {
            const dialogCategory = this.element.find(`#${category}`);
            this.data.details[category] = npcGenGPTLib.getSelectedOption(dialogCategory);
        });
        const { cr, race, type, subtype } = this.data.details;
        this.data.details.optionalName = this.element.find('#name').val();
        this.data.details.sheet = (type.value === 'commoner') ? 'npc-generator-gpt.dialog.subtype.label' : 'npc-generator-gpt.dialog.subtype.class';
        this.data.abilities = this.generateNpcAbilities(subtype.value, cr.value);
        this.data.attributes = this.generateNpcAttributes(race.value, subtype.value, cr.value);
        this.data.skills = this.generateNpcSkills(race.value, subtype.value);
        this.data.traits = this.generateNpcTraits(race.value, subtype.value);
        this.data.currency = npcGenGPTLib.getNpcCurrency(cr.value);
    }

    initQuery() {
        const { optionalName, gender, race, subtype, alignment, optionalContext, cr } = this.data.details;
        let options = `${gender.label}, ${race.label}, ${subtype.label}, ${alignment.label}`;
        if (optionalName) options = `(${game.i18n.localize("npc-generator-gpt.query.name")}: ${optionalName}) ${options}`; 
        if (optionalContext) options = `(${game.i18n.localize("npc-generator-gpt.query.context")}: ${optionalContext}) ${options}`; 
        return npcGenGPTDataStructure.getGenerateQueryTemplate(options, !!optionalContext) + `, "uniqueMagicalWeapon": { "cr": ${cr} }`;
    }

    mergeGptData(gptData) {
        const { name: gptName, spells, items, appearance, background, roleplaying, readaloud, uniqueMagicalWeapon } = gptData;
        this.data.name = gptName;
        this.data.spells = spells;
        this.data.items = items;
        this.data.uniqueMagicalWeapon = uniqueMagicalWeapon; // Store unique magical weapon details
        if (gptData.strength) this.data.abilities.str.value = gptData.strength;
        if (gptData.dexterity) this.data.abilities.dex.value = gptData.dexterity;
        if (gptData.constitution) this.data.abilities.con.value = gptData.constitution;
        if (gptData.wisdom) this.data.abilities.wis.value = gptData.wisdom;
        if (gptData.intelligence) this.data.abilities.int.value = gptData.intelligence;
        if (gptData.charisma) this.data.abilities.cha.value = gptData.charisma;
        this.data.details = {
            ...this.data.details,
            source: "NPC Generator (GPT)",
            biography: {
                appearance: appearance,
                background: background,
                roleplaying: roleplaying,
                readaloud: readaloud
            }
        };
    }

    async createNPC() {
        try {
            const { abilities, attributes, details, name, skills, traits, currency } = this.data;
            const fakeAlign = (game.settings.get(CONSTANTS.MODULE_ID, "hideAlignment")) ? game.i18n.localize("npc-generator-gpt.sheet.unknown") : details.alignment.label;
            const bioContent = await npcGenGPTLib.getTemplateStructure(CONSTANTS.TEMPLATE.SHEET, this.data);

            const npc = await Actor.create({ name: name, type: "npc" });
            await npc.update({
                system: {
                    details: {
                        source: details.source,
                        cr: details.cr.value,
                        alignment: fakeAlign,
                        race: details.race.label,
                        biography: { value: bioContent },
                        type: { value: 'custom', custom: details.race.label }
                    },
                    traits: { size: traits.size, languages: { value: traits.languages } },
                    abilities: abilities,
                    attributes: {
                        hp: attributes.hp,
                        'ac.value': attributes.ac,
                        movement: attributes.movement,
                        senses: attributes.senses,
                        spellcasting: attributes.spellcasting
                    },
                    skills: skills,
                    currency: currency
                }
            });

            let comp = npcGenGPTLib.getSettingsPacks();
            npcGenGPTLib.addItemstoNpc(npc, comp.items, this.data.items);
            npcGenGPTLib.addItemstoNpc(npc, comp.spells, this.data.spells);

            // Create unique magical weapon item
            const magicalWeaponData = await this.createUniqueMagicalWeaponItem(this.data.uniqueMagicalWeapon);
            if (magicalWeaponData) {
                await npc.createEmbeddedDocuments("Item", [magicalWeaponData]);
            }

            npc.sheet.render(true);

            this.close();
            ui.notifications.info(`${CONSTANTS.LOG_PREFIX} ${game.i18n.format("npc-generator-gpt.status.done", { npcName: name })}`);
        } catch (error) {
            console.error(`${CONSTANTS.LOG_PREFIX} Error during NPC creation:`, error);
            ui.notifications.error(`${CONSTANTS.LOG_PREFIX} ${game.i18n.localize("npc-generator-gpt.status.error3")}`);
        }
    }

    async createUniqueMagicalWeaponItem(uniqueMagicalWeapon) {
        return {
            name: uniqueMagicalWeapon.name,
            type: "weapon",
            data: {
                description: { value: uniqueMagicalWeapon.description },
                damage: { parts: [[`1d8 + @mod + ${uniqueMagicalWeapon.damageBonus}`, uniqueMagicalWeapon.damageType]] },
                properties: uniqueMagicalWeapon.properties,
                rarity: uniqueMagicalWeapon.rarity,
                magic: true,
                scaling: uniqueMagicalWeapon.scaling
            },
            effects: this.createWeaponEffects(uniqueMagicalWeapon.effects)
        };
    }

    createWeaponEffects(effects) {
        return effects.map(effect => ({
            label: effect.name,
            icon: effect.icon,
            origin: null,
            disabled: false,
            duration: effect.duration,
            changes: effect.changes,
            transfer: true
        }));
    }
}
