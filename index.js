const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

const getLogTime = () => {
    const now = new Date();
    return `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
};

const sentUsers = new Set();
let tokens = [];
let currentTokenIndex = 0;
let config = {}; 

const CONFIG_FILE = 'config.json';

function loadConfig() {
    try {
        const data = fs.readFileSync(CONFIG_FILE, 'utf8');
        config = JSON.parse(data);
        console.log(`✅ ${getLogTime()} - ${CONFIG_FILE} başarıyla yüklendi.`); 
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.error(`❌ ${getLogTime()} - Hata: ${CONFIG_FILE} dosyası bulunamadı. Lütfen aynı dizinde '${CONFIG_FILE}' adında bir dosya oluşturun.`); 
        } else if (err instanceof SyntaxError) {
            console.error(`❌ ${getLogTime()} - Hata: ${CONFIG_FILE} dosyası geçersiz JSON formatında: ${err.message}`); 
        } else {
            console.error(`❌ ${getLogTime()} - Hata: ${CONFIG_FILE} dosyası okunamadı: ${err.message}`); 
        }
        process.exit(1);
    }
}


function loadTokens() {
    let tokensFilePath = config.botTokenFile || 'tokens.txt'; 
    try {
        const data = fs.readFileSync(tokensFilePath, 'utf8');
        tokens = data.split('\n').map(token => token.trim()).filter(token => token.length > 0);
        if (tokens.length === 0) {
            console.error(`❌ ${getLogTime()} - Hata: ${tokensFilePath} dosyasında hiç token bulunamadı.`); 
            process.exit(1);
        }
        console.log(`✅ ${getLogTime()} - ${tokens.length} adet token ${tokensFilePath} dosyasından yüklendi.`);
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.error(`❌ ${getLogTime()} - Hata: ${tokensFilePath} dosyası bulunamadı. Lütfen aynı dizinde '${tokensFilePath}' adında bir dosya oluşturun ve içine tokenlerinizi yazın.`); 
        } else {
            console.error(`❌ ${getLogTime()} - Hata: ${tokensFilePath} dosyası okunamadı: ${err.message}`); 
        }
        process.exit(1);
    }
}

function moveTokenToTrash(tokenToMove) {
    const tokensFilePath = config.botTokenFile || 'tokens.txt';
    const trashTokensFilePath = config.trashTokenFile || 'trashtokens.txt';

    console.log(`⚠️ ${getLogTime()} - Token '${tokenToMove}' geçersiz, spam olarak işaretlendi veya kullanılamıyor.`); 
    console.log(`ℹ️ ${getLogTime()} - ${tokensFilePath} dosyasından kaldırılıyor ve ${trashTokensFilePath} dosyasına taşınıyor.`); 

    tokens = tokens.filter(t => t !== tokenToMove);
    fs.writeFileSync(tokensFilePath, tokens.join('\n') + (tokens.length > 0 ? '\n' : ''), 'utf8');

    fs.appendFileSync(trashTokensFilePath, tokenToMove + '\n', 'utf8');

    console.log(`✅ ${getLogTime()} - Token başarıyla taşındı.`); 
}



async function loginAndRunBot(token) {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.DirectMessages,
            GatewayIntentBits.MessageContent,
        ],
    });

    client.on('ready', async () => {
        console.log(`✅ ${getLogTime()} - Bot '${client.user.tag}' olarak giriş yaptı.`); 
    });

    client.on('guildCreate', async guild => {
        console.log(`✅ ${getLogTime()} - Bot yeni bir sunucuya katıldı: ${guild.name} (${guild.id})`); 
        await sendDmToGuildMembers(guild, client.token);
    });

    client.on('error', error => {
        console.error(`❌ ${getLogTime()} - Bot genel bir API hatası yakaladı: ${error.message}`); 

        const currentToken = client.token;

        if (error.message.includes('An invalid token was provided') || error.httpStatus === 401) {
            console.error(`❌ ${getLogTime()} - Hata: Geçersiz token sağlandı. Bir sonraki tokene geçiliyor.`); 
            moveTokenToTrash(currentToken);
            switchToNextToken();
        } else if (error.message.includes('Rate limit exceeded') || error.httpStatus === 429) {
            console.error(`❌ ${getLogTime()} - Hata: Discord API hız limiti aşıldı (429). Bir sonraki tokene geçiliyor.`); 
            switchToNextToken();
        } else if (error.message.includes('Bot flagged as spam') || (error.code && (error.code === 10003 || error.code === 50007))) {
            console.error(`❌ ${getLogTime()} - Bot spam olarak işaretlenmiş veya DM engellenmiş olabilir. Bir sonraki tokene geçiliyor.`); 
            moveTokenToTrash(currentToken);
            switchToNextToken();
        } else {
            console.error(`❌ ${getLogTime()} - Bilinmeyen bir hata oluştu. Bir sonraki tokene geçiliyor.`); 
            switchToNextToken();
        }
    });

    try {
        await client.login(token);
    } catch (error) {
        console.error(`❌ ${getLogTime()} - Giriş hatası (Token: ${token}): ${error.message}`); 

        if (error.message.includes('An invalid token was provided') || error.code === 'TOKEN_INVALID' || error.httpStatus === 401) {
            console.error(`❌ ${getLogTime()} - Hata: Geçersiz token sağlandı. Bir sonraki tokene geçiliyor.`); 
            moveTokenToTrash(token);
            switchToNextToken();
        } else {
            console.error(`❌ ${getLogTime()} - Bilinmeyen bir giriş hatası. Bir sonraki tokene geçiliyor.`);
            switchToNextToken();
        }
    }
}


async function sendDmToGuildMembers(guild, currentBotToken) {
    const dmConfig = config.dmMessage;
    if (!dmConfig) {
        console.error(`❌ ${getLogTime()} - Hata: config.json içinde 'dmMessage' ayarları bulunamadı.`); 
        return;
    }

    try {
        console.log(`🔄  ${guild.name} (${guild.id}) sunucusu için üyeler çekiliyor...`); 
        const members = await guild.members.fetch().catch(fetchErr => {
            console.error(`❌ ${getLogTime()} - ${guild.name} (${guild.id}) sunucusunun üyelerini getirirken HATA OLUŞTU!`); 
            console.error(`❌ ${getLogTime()} - Hata Mesajı: ${fetchErr.message}`); 
            console.error(`❌ ${getLogTime()} - Hata Kodu: ${fetchErr.code || 'Yok'}`); 
            console.error(`❌ ${getLogTime()} - Tam Hata Objeleri:`, fetchErr);

            if (fetchErr.code === 50001) {
                console.error(`⚠️ ${getLogTime()} - Botun sunucuya erişim veya üye okuma yetkisi yok. Bir sonraki tokene geçilmiyor.`); 
            } else if (fetchErr.code === 10003) {
                console.error(`⚠️ ${getLogTime()} - Sunucuya erişim sağlanamadı. Sunucu kaldırılmış olabilir.`);
            } else {
                console.error(`❌ ${getLogTime()} - Beklenmeyen bir üye çekme hatası. Bir sonraki tokene geçilmiyor.`); 
            }
            throw fetchErr;
        });
        console.log(`✅${guild.name} sunucusunun üyeleri başarıyla çekildi. Toplam üye: ${members.size}`); 

        const nonBotMembers = members.filter(member => !member.user.bot);
        const totalNonBotMembers = nonBotMembers.size;
        let dmSentInGuildCount = 0;


        for (const member of nonBotMembers.values()) {
            if (member.user.bot) continue;

            if (sentUsers.has(member.user.id)) {
                console.log(`ℹ️ ${getLogTime()} - ${member.user.tag} (${member.user.id}) adlı kullanıcıya daha önce mesaj gönderildi, atlanıyor.`); 
                continue;
            }

            let finalNormalMessage = dmConfig.normalText
                .replace(/<@\[USER_ID\]>/g, `<@${member.user.id}>`)
                .replace(/@\[USERNAME\]/g, `@${member.user.username}`);

            const embed = new EmbedBuilder()
                .setColor(dmConfig.embed.color || 0x0099FF)
                .setTitle(dmConfig.embed.title)
                .setURL(dmConfig.embed.url);

            if (dmConfig.embed.description) {
                embed.setDescription(dmConfig.embed.description);
            }
            if (dmConfig.embed.author) {
                embed.setAuthor({
                    name: dmConfig.embed.author.name,
                    iconURL: dmConfig.embed.author.iconURL,
                    url: dmConfig.embed.author.url
                });
            }
            if (dmConfig.embed.thumbnailURL) {
                embed.setThumbnail(dmConfig.embed.thumbnailURL);
            }
            if (dmConfig.embed.imageURL) {
                embed.setImage(dmConfig.embed.imageURL);
            }
            if (dmConfig.embed.timestamp === true) {
                embed.setTimestamp();
            } else {
                if (dmConfig.embed.timestamp !== false) {
                    embed.setTimestamp();
                }
            }

            if (dmConfig.embed.fields && Array.isArray(dmConfig.embed.fields)) {
                for (const field of dmConfig.embed.fields) {
                    let fieldName = field.name
                        .replace(/<@\[USER_ID\]>/g, `<@${member.user.id}>`)
                        .replace(/@\[USERNAME\]/g, `@${member.user.username}`);

                    let fieldValue = field.value
                        .replace(/<@\[USER_ID\]>/g, `<@${member.user.id}>`)
                        .replace(/@\[USERNAME\]/g, `@${member.user.username}`);

                    if (field.dynamicTimestamp) {
                        const now = new Date();
                        const offsetMinutes = field.timestampOffsetMinutes !== undefined ? field.timestampOffsetMinutes : 0;
                        const targetTime = new Date(now.getTime() + offsetMinutes * 60 * 1000);
                        const discordTimestampFormat = field.timestampFormat || 'f';

                        fieldValue = `<t:${Math.floor(targetTime.getTime() / 1000)}:${discordTimestampFormat}>`;
                    }

                    embed.addFields({ name: fieldName, value: fieldValue, inline: field.inline || false });
                }
            }
            if (dmConfig.embed.footer) {
                embed.setFooter({
                    text: dmConfig.embed.footer.text,
                    iconURL: dmConfig.embed.footer.iconURL
                });
            }

            const button = new ButtonBuilder()
                .setLabel(dmConfig.button.label)
                .setURL(dmConfig.button.url)
                .setStyle(ButtonStyle.Link);

            const actionRow = new ActionRowBuilder().addComponents(button);

            try {
                await member.send({
                    content: finalNormalMessage,
                    embeds: [embed],
                    components: [actionRow]
                });
                dmSentInGuildCount++;
                console.log(`✅ ${member.user.tag}  adlı kullanıcıya DM gönderildi. (${dmSentInGuildCount}/${totalNonBotMembers})`); 
                sentUsers.add(member.user.id);
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (dmError) {
                if (dmError.code === 50007) {
                    console.log(`⚠️ ${getLogTime()} - ${member.user.tag} (${member.user.id}) adlı kullanıcının DM'leri kapalı veya engelledi.`); 
                } else if (dmError.message.includes('Rate limit exceeded') || dmError.code === 429) {
                    console.error(`❌ ${getLogTime()} - Hata: DM gönderirken hız limiti aşıldı (429). Mevcut tokeni çöpe taşınıyor ve bir sonraki tokene geçiliyor.`); 
                    moveTokenToTrash(currentBotToken);
                    return;
                } else if (dmError.message.includes('Bot flagged as spam') || (dmError.code && dmError.code !== 50007)) {
                    console.error(`❌ ${getLogTime()} - Bot DM gönderirken spam olarak işaretlenmiş veya beklenmeyen bir API hatası oluştu: ${dmError.message}. Mevcut tokeni çöpe taşınıyor ve bir sonraki tokene geçiliyor.`); 
                    console.error(`❌ ${getLogTime()} - Tam DM Hatası Objeleri:`, dmError); 
                    moveTokenToTrash(currentBotToken);
                    switchToNextToken();
                    return;
                } else {
                    console.error(`❌ ${getLogTime()} - ${member.user.tag} (${member.user.id}) adlı kullanıcıya DM gönderilirken beklenmeyen bir hata oluştu: ${dmError.message}`); 
                    console.error(`❌ ${getLogTime()} - Tam DM Hatası Objeleri:`, dmError); 
                }
            }
        }
    } catch (fetchError) {
        console.error(`❌ ${getLogTime()} - ${guild.name} sunucusunun üyelerini çekme veya işleme sırasında KRİTİK bir hata oluştu: ${fetchError.message}`); 
        console.error(`❌ ${getLogTime()} - Tam Kritik Hata Objeleri:`, fetchError); 
        if (fetchError.code === 50001 || fetchError.code === 10003) {
             console.log(`⚠️ ${getLogTime()} - Bu sunucudaki hata token değişimi gerektirmeyebilir (izin eksikliği).`); 
        } else {
            console.error(`❌ ${getLogTime()} - Bilinmeyen bir kritik hata. Mevcut tokeni çöpe taşınıyor ve bir sonraki tokene geçiliyor.`); 
            moveTokenToTrash(currentBotToken);
            switchToNextToken();
        }
    }
}


function switchToNextToken() {
    currentTokenIndex++;
    if (currentTokenIndex < tokens.length) {
        console.log(`➡️ ${getLogTime()} - Bir sonraki tokene geçiliyor... (${currentTokenIndex + 1}/${tokens.length})`); 
        if (client && typeof client.destroy === 'function') {
            client.destroy();
        }
        loginAndRunBot(tokens[currentTokenIndex]);
    } else {
        console.error(`🛑 ${getLogTime()} - Tüm tokenler denendi veya tüketildi. Program sonlandırılıyor.`); 
        process.exit(0);
    }
}

loadConfig();
loadTokens();


if (tokens.length > 0) {
    loginAndRunBot(tokens[currentTokenIndex]);
} else {
    console.error(`❌ ${getLogTime()} - Yüklenecek token bulunamadı. Program başlatılamadı.`); 
    process.exit(1);
}