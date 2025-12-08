const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config({ quiet: true });;

const app = express();
const port = process.env.PORT || 3000;


// 🌟🌟🌟 환경 변수에서 Gemini API 키 로드 🌟🌟🌟
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models"; // 기본 URL

// Use environment variables for database configuration
const dbConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    charset: process.env.DB_CHARSET
};

// MySQL Connection Pool 설정
const db = mysql.createPool(dbConfig);

// DB 접속 시 인코딩 설정 (utf8mb4 지원)
db.on('connection', function (connection) {
    connection.query('SET NAMES utf8mb4');
    connection.query('SET CHARACTER SET utf8mb4');
    connection.query('SET SESSION collation_connection = "utf8mb4_unicode_ci"');
});

// 미들웨어 설정
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
// ✅ [추가됨] 브라우저 캐시 방지 미들웨어 (항상 200 OK를 받기 위해 추가)
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
});
// --- API 엔드포인트 ---

// 🌟 [핵심 변경] Router 사용! 
// 이제 주소 앞에 '/api'를 중복해서 적지 않아도 됩니다.
const router = express.Router();

// 서버 및 DB 상태 확인 엔드포인트
router.get('/status', (req, res) => {
    db.getConnection((err, connection) => {
        if (err) {
            console.error('Database connection error on status check:', err);
            return res.status(500).json({
                serverStatus: 'Running',
                dbStatus: 'Disconnected',
                message: 'MySQL 연결 실패'
            });
        }

        connection.release(); // 연결 반환
        res.json({
            serverStatus: 'Running',
            dbStatus: 'Connected',
            message: 'API 및 DB 연결 상태 양호'
        });
    });
});

/**
 * 플롯 설정 목록 조회 (제목, ID)
 * GET /api/settings-list
 */
router.get('/settings-list', (req, res) => {
    // episode_number 필드 추가
    const sql = 'SELECT id, title, episode_number, worldSetting, characterDetails, plotDetails, updated_at FROM settings ORDER BY updated_at DESC';
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Database error in /api/settings-list:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.status(200).json(results);
    });
});

/**
 * 특정 플롯 설정 로드
 * GET /api/load-settings?id={id}
 */
router.get('/load-settings', (req, res) => {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'ID is required' });
    const sql = 'SELECT * FROM settings WHERE id = ?';
    db.query(sql, [id], (err, results) => {
        if (err) return res.status(500).json({ error: 'Database load failed.' });
        if (results.length === 0) return res.status(404).json({ error: 'Setting not found' });
        res.status(200).json(results[0]);
    });
});

/**
 * 플롯 설정 저장 및 업데이트 (episode_number 포함)
 * POST /api/save-settings
 */
app.post('/api/save-settings', (req, res) => {
    // episode_number 필드 추가
    const { id, title, worldSetting, characterDetails, plotDetails, previousContent, episode_number } = req.body;

    if (!title || episode_number === undefined || episode_number === null) return res.status(400).json({ error: 'Title and episode number are required.' });

    if (id && id !== 'null') { // 기존 플롯 업데이트
        const sql = `UPDATE settings SET title=?, worldSetting=?, characterDetails=?, plotDetails=?, previousContent=?, episode_number=? WHERE id=?`;
        db.query(sql, [title, worldSetting, characterDetails, plotDetails, previousContent, episode_number, id], (err, result) => {
            if (err) {
                console.error("❌ 설정 업데이트 실패:", err.message);
                return res.status(500).json({ error: err.message });
            }
            res.status(200).json({ message: 'Updated successfully', id: id });
        });
    } else { // 새 플롯 삽입
        const sql = `INSERT INTO settings (title, worldSetting, characterDetails, plotDetails, previousContent, episode_number) VALUES (?, ?, ?, ?, ?, ?)`;
        db.query(sql, [title, worldSetting, characterDetails, plotDetails, previousContent, episode_number], (err, result) => {
            if (err) {
                console.error("❌ 설정 생성 실패:", err.message);
                return res.status(500).json({ error: err.message });
            }
            res.status(200).json({ message: 'Created successfully', id: result.insertId });
        });
    }
});


// --- 세계관 (World Settings) 관리 API 엔드포인트 ---

/**
 * 특정 설정에 연결된 세계관 목록 조회
 * GET /api/worldsettings?setting_id={setting_id}
 */
router.get('/worldsettings', (req, res) => {
    const setting_id = req.query.setting_id;
    if (!setting_id) return res.status(400).json({ error: 'setting_id is required' });

    // created_at 순으로 정렬
    const sql = 'SELECT id, setting_id, title, description, created_at FROM world_settings WHERE setting_id = ? ORDER BY created_at ASC';
    db.query(sql, [setting_id], (err, results) => {
        if (err) {
            console.error('Database load error in /api/worldsettings:', err);
            return res.status(500).json({ error: 'Database load failed.' });
        }
        res.status(200).json(results);
    });
});
/**
 * 특정 세계관 단일 항목 조회
 * HTTP Method: GET
 * @param {string} req.params.id - 조회할 세계관의 고유 ID
 */
router.get('/worldsettings/:id', (req, res) => {
    const worldSettingId = req.params.id;

    if (!worldSettingId) {
        return res.status(400).json({ error: 'World Setting ID is required for single retrieval.' });
    }

    // worldSettingId (고유 ID)를 사용해 단 하나의 레코드를 조회
    const sql = 'SELECT id, setting_id, title, description, created_at FROM world_settings WHERE id = ?';

    db.query(sql, [worldSettingId], (err, results) => {
        if (err) {
            console.error('Database load error in /api/worldsettings (Read):', err);
            return res.status(500).json({ error: 'Database load failed.' });
        }

        if (results.length === 0) {
            console.warn(`경고: ID ${worldSettingId}의 세계관을 찾지 못했습니다.`);
            return res.status(404).json({ error: 'World setting not found.' });
        }

        console.log(`✅ 세계관 단일 조회 완료. ID: ${worldSettingId}`);
        // 단일 항목을 반환
        res.status(200).json(results[0]);
    });
});
/**
 * 새로운 세계관 추가
 * POST /api/worldsettings
 */
app.post('/api/worldsettings', (req, res) => {
    const { setting_id, title, description } = req.body;

    if (!setting_id || !title) {
        return res.status(400).json({ error: 'setting_id and title are required.' });
    }

    const sql = `INSERT INTO world_settings (setting_id, title, description) VALUES (?, ?, ?)`;

    db.query(sql, [setting_id, title, description || null], (err, result) => {
        if (err) {
            console.error("❌ 세계관 추가 실패:", err.message);
            return res.status(500).json({ error: err.message });
        }
        console.log(`✅ 세계관 저장 완료. ID: ${result.insertId}`);
        res.status(201).json({ message: 'World setting created successfully', id: result.insertId });
    });
});


/**
 * 특정 세계관 수정 (업데이트)
 * PUT /api/worldsettings/:id
 * 🚨 이 라우트가 수정 기능을 담당하며, MySQL UPDATE 쿼리를 실행합니다.
 */
app.put('/api/worldsettings/:id', (req, res) => {
    const worldSettingId = req.params.id;
    const { title, description } = req.body;

    if (!worldSettingId || !title) {
        return res.status(400).json({ error: 'World Setting ID and title are required for update.' });
    }

    // world_settings 테이블 업데이트 쿼리
    const sql = `UPDATE world_settings SET title = ?, description = ? WHERE id = ?`;

    db.query(sql, [title, description || null, worldSettingId], (err, result) => {
        if (err) {
            console.error("❌ 세계관 수정 실패:", err.message);
            return res.status(500).json({ error: err.message });
        }

        if (result.affectedRows === 0) {
            // ID가 없거나, 변경된 내용이 없는 경우
            return res.status(404).json({ error: 'World setting not found or no changes made.' });
        }

        console.log(`✅ 세계관 수정 완료. ID: ${worldSettingId}`);
        res.status(200).json({ message: 'World setting updated successfully', id: worldSettingId });
    });
});

/**
 * 특정 세계관 삭제
 * DELETE /api/worldsettings/:id
 */
app.delete('/api/worldsettings/:id', (req, res) => {
    const worldSettingId = req.params.id;

    if (!worldSettingId) {
        console.error("❌ 세계관 ID 누락");
        return res.status(400).json({ error: 'World Setting ID is required' });
    }

    const sql = 'DELETE FROM world_settings WHERE id = ?';
    db.query(sql, [worldSettingId], (err, result) => {
        if (err) {
            console.error("❌ 세계관 삭제 실패:", err.message);
            return res.status(500).json({ error: err.message });
        }
        if (result.affectedRows === 0) {
            // 이 경우, ID가 존재하지 않았거나 이미 삭제되었을 수 있습니다.
            console.warn(`경고: ID ${worldSettingId}의 세계관을 찾지 못했습니다.`);
            return res.status(404).json({ error: 'World setting not found or already deleted' });
        }
        console.log(`✅ 세계관 삭제 완료. ID: ${worldSettingId}`);
        res.status(200).json({ message: 'World setting deleted successfully' });
    });
});

// --- 등장인물 관리 API 엔드포인트 (기존) ---

/**
 * 특정 설정에 연결된 등장인물 목록 조회
 * GET /api/characters?setting_id={setting_id}
 */
router.get('/characters', (req, res) => {
    const setting_id = req.query.setting_id;
    if (!setting_id) return res.status(400).json({ error: 'setting_id is required' });

    // created_at 순으로 정렬
    const sql = 'SELECT id, setting_id, name, role, description, created_at FROM characters WHERE setting_id = ? ORDER BY created_at ASC';
    db.query(sql, [setting_id], (err, results) => {
        if (err) {
            console.error('Database load error in /api/characters:', err);
            return res.status(500).json({ error: 'Database load failed.' });
        }
        res.status(200).json(results);
    });
});

/**
 * 새로운 등장인물 추가
 * POST /api/characters
 */
app.post('/api/characters', (req, res) => {
    const { setting_id, name, role, description } = req.body;

    if (!setting_id || !name) {
        return res.status(400).json({ error: 'setting_id and name are required.' });
    }

    const sql = `INSERT INTO characters (setting_id, name, role, description) VALUES (?, ?, ?, ?)`;

    db.query(sql, [setting_id, name, role || null, description || null], (err, result) => {
        if (err) {
            console.error("❌ 등장인물 추가 실패:", err.message);
            return res.status(500).json({ error: err.message });
        }
        console.log(`✅ 등장인물 저장 완료. ID: ${result.insertId}`);
        res.status(201).json({ message: 'Character created successfully', id: result.insertId });
    });
});

// 등장인물 대량 추가 (AI 생성용)
app.post('/api/characters/bulk', (req, res) => {
    const { characters } = req.body;

    if (!characters || !Array.isArray(characters) || characters.length === 0) {
        return res.status(400).json({ message: 'The request body must contain a non-empty array of "characters".' });
    }

    // 모든 캐릭터가 동일한 setting_id를 갖는지 확인 (프론트엔드 로직에 의존)
    const firstSettingId = characters[0].setting_id;
    if (!firstSettingId) {
        return res.status(400).json({ message: 'All characters must have a valid setting_id.' });
    }

    // SQL 값 배열 준비
    const values = [];
    let placeholders = '';

    characters.forEach(char => {
        // setting_id 일치 여부 확인은 스킵하고, 첫 번째 ID를 사용하거나 모두 사용.
        // 여기서는 모든 캐릭터에 대해 setting_id를 포함하여 처리합니다.
        values.push(char.setting_id, char.name, char.role, char.description);
        placeholders += '(?, ?, ?, ?),';
    });

    // 마지막 쉼표 제거
    placeholders = placeholders.slice(0, -1);

    const sql = `
        INSERT INTO characters (setting_id, name, role, description)
        VALUES ${placeholders}
    `;

    db.query(sql, values, (err, result) => {
        if (err) {
            console.error('Error bulk adding characters:', err);
            return res.status(500).json({ message: 'Failed to bulk add characters.', error: err.message });
        }
        console.log(`Successfully bulk added ${result.affectedRows} characters.`);
        res.status(201).json({
            message: `${result.affectedRows} characters added successfully.`,
            rowsAffected: result.affectedRows
        });
    });
});

/**
 * 특정 등장인물 수정 (업데이트)
 * PUT /api/characters/:id
 */
app.put('/api/characters/:id', (req, res) => {
    const charId = req.params.id;
    const { name, role, description } = req.body;

    if (!charId || !name) {
        return res.status(400).json({ error: 'Character ID and name are required for update.' });
    }

    // `updated_at` 필드가 있다면 NOW()로 업데이트 가능
    const sql = `UPDATE characters SET name = ?, role = ?, description = ? WHERE id = ?`;

    db.query(sql, [name, role || null, description || null, charId], (err, result) => {
        if (err) {
            console.error("❌ 등장인물 수정 실패:", err.message);
            return res.status(500).json({ error: err.message });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Character not found or no changes made.' });
        }

        console.log(`✅ 등장인물 수정 완료. ID: ${charId}`);
        res.status(200).json({ message: 'Character updated successfully', id: charId });
    });
});

/**
 * 특정 등장인물 삭제
 * DELETE /api/characters/:id
 */
app.delete('/api/characters/:id', (req, res) => {
    const charId = req.params.id;

    if (!charId) return res.status(400).json({ error: 'Character ID is required' });

    const sql = 'DELETE FROM characters WHERE id = ?';
    db.query(sql, [charId], (err, result) => {
        if (err) {
            console.error("❌ 등장인물 삭제 실패:", err.message);
            return res.status(500).json({ error: err.message });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Character not found' });
        }
        console.log(`✅ 등장인물 삭제 완료. ID: ${charId}`);
        res.status(200).json({ message: 'Character deleted successfully' });
    });
});

// --- 스토리 관련 기존 엔드포인트 ---


/**
 * 플롯 및 관련 회차 삭제 (트랜잭션 사용)
 * DELETE /api/delete-settings?id={id}
 */
app.delete('/api/delete-settings', (req, res) => {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'ID is required' });

    db.getConnection((err, connection) => {
        if (err) return res.status(500).json({ error: 'Database connection error' });

        connection.beginTransaction(err => {
            if (err) { connection.release(); return res.status(500).json({ error: 'Transaction start failed' }); }

            // 1. Delete associated world settings (New: `world_settings` 테이블 삭제 추가)
            const deleteWorldSettingsSql = 'DELETE FROM world_settings WHERE setting_id = ?';
            connection.query(deleteWorldSettingsSql, [id], (err, result) => {
                if (err) {
                    return connection.rollback(() => {
                        connection.release();
                        res.status(500).json({ error: 'Failed to delete world settings' });
                    });
                }

                // 2. Delete associated characters
                const deleteCharactersSql = 'DELETE FROM characters WHERE setting_id = ?';
                connection.query(deleteCharactersSql, [id], (err, result) => {
                    if (err) {
                        return connection.rollback(() => {
                            connection.release();
                            res.status(500).json({ error: 'Failed to delete characters' });
                        });
                    }

                    // 3. Delete associated stories (episodes)
                    const deleteStoriesSql = 'DELETE FROM stories WHERE setting_id = ?';
                    connection.query(deleteStoriesSql, [id], (err, result) => {
                        if (err) {
                            return connection.rollback(() => {
                                connection.release();
                                res.status(500).json({ error: 'Failed to delete stories' });
                            });
                        }

                        // 4. Delete the setting itself
                        const deleteSettingsSql = 'DELETE FROM settings WHERE id = ?';
                        connection.query(deleteSettingsSql, [id], (err, result) => {
                            if (err) {
                                return connection.rollback(() => {
                                    connection.release();
                                    res.status(500).json({ error: 'Failed to delete setting' });
                                });
                            }

                            // 5. Commit the transaction
                            connection.commit(err => {
                                if (err) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        res.status(500).json({ error: 'Transaction commit failed' });
                                    });
                                }

                                connection.release();
                                res.status(200).json({ message: 'Setting, associated world settings, characters, and stories deleted successfully' });
                            });
                        });
                    });
                });
            });
        });
    });
});


// ==========================================
// 🌟 [통합] 스토리(회차) 관리 API (Table: stories)
// ==========================================

/**
 * 1. 회차 목록 조회
 * GET /api/stories?setting_id={id}
 * - 1화부터 순서대로 정렬 (ASC)
 */
router.get('/stories', (req, res) => {
    const settingId = req.query.setting_id;
    if (!settingId) return res.status(400).json({ error: 'setting_id is required' });

    // created_at을 프론트엔드에서 쓰기 편하게 createdAt으로 별칭 처리
    const sql = `
        SELECT id, setting_id, episode_number, title, content, prompt, created_at AS createdAt 
        FROM stories 
        WHERE setting_id = ? 
        ORDER BY episode_number ASC
    `;

    db.query(sql, [settingId], (err, results) => {
        if (err) {
            console.error('DB Error /api/stories (GET):', err);
            return res.status(500).json({ error: '데이터 로드 실패' });
        }
        res.status(200).json(results);
    });
});

/**
 * 2. 새 회차 생성
 * POST /api/stories
 * - content가 비어있어도 생성 가능하도록 처리
 */
app.post('/api/stories', (req, res) => {
    const { setting_id, episode_number, title, content, prompt } = req.body;

    // 필수값 체크 (내용은 없어도 됨)
    if (!setting_id || !episode_number || !title) {
        return res.status(400).json({ message: '필수 항목 누락: setting_id, episode_number, title' });
    }

    const sql = `
        INSERT INTO stories (setting_id, episode_number, title, content, prompt, created_at) 
        VALUES (?, ?, ?, ?, ?, NOW())
    `;
    
    // undefined 방지
    const safeContent = content === undefined ? '' : content;
    const safePrompt = prompt || 'User Created';

    db.query(sql, [setting_id, episode_number, title, safeContent, safePrompt], (err, result) => {
        if (err) {
            console.error('DB Error /api/stories (POST):', err);
            return res.status(500).json({ message: '저장 실패', error: err.message });
        }
        
        console.log(`✅ 스토리 생성 완료. ID: ${result.insertId}, ${episode_number}화`);
        res.status(201).json({
            message: '성공적으로 생성되었습니다.',
            id: result.insertId,
            episode_number: episode_number
        });
    });
});

/**
 * 3. 회차 수정 (내용/제목 업데이트)
 * PUT /api/stories/:id
 */
app.put('/api/stories/:id', (req, res) => {
    const storyId = req.params.id;
    const { episode_number, title, content } = req.body;

    if (!storyId || !title) {
        return res.status(400).json({ message: 'ID와 제목은 필수입니다.' });
    }

    // updated_at 컬럼이 있다면 업데이트, 없으면 내용만 업데이트
    // 여기서는 안전하게 내용 위주로 작성 (필요시 updatedAt = NOW() 추가)
    const sql = `
        UPDATE stories 
        SET episode_number = ?, title = ?, content = ?
        WHERE id = ?
    `;

    // content가 undefined면 기존 내용을 지우지 않도록 처리해야 하나, 
    // 에디터 특성상 빈 문자열도 "삭제"로 볼 수 있으므로 그대로 저장합니다.
    const safeContent = content === undefined ? '' : content;

    db.query(sql, [episode_number, title, safeContent, storyId], (err, result) => {
        if (err) {
            console.error(`DB Error /api/stories/${storyId} (PUT):`, err);
            return res.status(500).json({ message: '수정 실패', error: err.message });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: '해당 스토리를 찾을 수 없습니다.' });
        }

        console.log(`✅ 스토리 수정 완료. ID: ${storyId}`);
        res.status(200).json({ message: '수정 완료', id: storyId });
    });
});

/**
 * 4. 회차 삭제
 * DELETE /api/stories/:id
 */
app.delete('/api/stories/:id', (req, res) => {
    const storyId = req.params.id;
    if (!storyId) return res.status(400).json({ error: 'Story ID required' });

    const sql = 'DELETE FROM stories WHERE id = ?';
    db.query(sql, [storyId], (err, result) => {
        if (err) {
            console.error("DB Error /api/stories (DELETE):", err);
            return res.status(500).json({ error: err.message });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: '삭제할 스토리가 없습니다.' });
        }
        console.log(`✅ 스토리 삭제 완료. ID: ${storyId}`);
        res.status(200).json({ message: '삭제되었습니다.' });
    });
});




// ==========================================
// 🌟 [통합] 에피소드(플롯) 관리 API (Table: episodes)
// ==========================================

/**
 * [GET] /api/episodes?setting_id=X
 * 특정 설정의 모든 에피소드 목록을 가져옵니다.
 */
app.get(`/api/episodes`, (req, res) => {
    const settingId = req.query.setting_id;
    if (!settingId) {
        return res.status(400).json({ message: 'Setting ID is required.' });
    }

    // createdAt을 프론트엔드 호환성을 위해 유지하거나 별칭 사용
    const sql = 'SELECT id, setting_id, episode_number, title, prompt, content, createdAt FROM episodes WHERE setting_id = ? ORDER BY episode_number ASC';

    db.query(sql, [settingId], (err, results) => {
        if (err) {
            console.error(`Error fetching episodes for setting ${settingId}:`, err);
            return res.status(500).json({ message: 'Failed to fetch episodes.', error: err.message });
        }
        res.status(200).json(results);
    });
});

/**
 * [GET] /api/previous-stories?setting_id=X&episode_number=Y
 * AI 프롬프트 구성을 위해, 특정 에피소드(Y) 직전의 최신 5개 에피소드만 가져옵니다.
 */
app.get(`/api/previous-stories`, (req, res) => {
    const { setting_id, episode_number } = req.query;
    if (!setting_id || !episode_number) {
        return res.status(400).json({ message: 'Setting ID and episode number are required.' });
    }

    const sql = `
        SELECT episode_number, title, prompt, content
        FROM episodes
        WHERE setting_id = ? AND episode_number < ?
        ORDER BY episode_number DESC
        LIMIT 5
    `;

    db.query(sql, [setting_id, episode_number], (err, results) => {
        if (err) {
            console.error(`Error fetching previous stories:`, err);
            return res.status(500).json({ message: 'Failed to fetch previous stories.', error: err.message });
        }
        res.status(200).json(results.reverse());
    });
});

/**
 * [POST] /api/episodes
 * 새로 생성된 에피소드를 데이터베이스에 저장합니다.
 */
app.post(`/api/episodes`, (req, res) => {
    const { setting_id, episode_number, title, content, prompt } = req.body;

    // 🚨 주의: content가 필수값이므로 프론트엔드에서 최소한 공백(" ")이라도 보내야 합니다.
    if (!setting_id || !episode_number || !title || content === undefined) {
        return res.status(400).json({ message: 'Required fields are missing.' });
    }

    const sql = `
        INSERT INTO episodes 
        (setting_id, episode_number, title, content, prompt, createdAt) 
        VALUES (?, ?, ?, ?, ?, NOW())
    `;
    // content가 빈 문자열일 경우를 대비해 처리 (validation 통과 전제)
    const values = [setting_id, episode_number, title, content, prompt || 'AI Generated'];

    db.query(sql, values, (err, result) => {
        if (err) {
            console.error('Error inserting new episode:', err);
            return res.status(500).json({ message: 'Failed to save episode.', error: err.message });
        }

        console.log(`Successfully inserted episode ${episode_number} (ID: ${result.insertId})`);
        res.status(201).json({
            message: 'Episode successfully saved.',
            id: result.insertId,
            episode_number: episode_number
        });
    });
});

/**
 * [PUT] /api/episodes/:id
 * 기존 에피소드를 ID를 기준으로 수정합니다.
 */
app.put(`/api/episodes/:id`, (req, res) => {
    const episodeId = req.params.id;
    const { episode_number, title, content } = req.body;

    if (!episode_number || !title || content === undefined) {
        return res.status(400).json({ message: 'Required update fields are missing.' });
    }

    const sql = `
        UPDATE episodes 
        SET episode_number = ?, title = ?, content = ?, updatedAt = NOW()
        WHERE id = ?
    `;
    const values = [episode_number, title, content, episodeId];

    db.query(sql, values, (err, result) => {
        if (err) {
            console.error(`Error updating episode ID ${episodeId}:`, err);
            return res.status(500).json({ message: `Failed to update episode ID ${episodeId}.`, error: err.message });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: `Episode ID ${episodeId} not found.` });
        }

        console.log(`Successfully updated episode ID ${episodeId}`);
        res.status(200).json({
            message: `Episode ID ${episodeId} successfully updated.`,
            id: episodeId
        });
    });
});

/**
 * [DELETE] /api/episodes/:id
 * 에피소드 삭제 (plot.html에서 삭제 기능 지원용)
 */
app.delete('/api/episodes/:id', (req, res) => {
    const episodeId = req.params.id;
    if (!episodeId) return res.status(400).json({ error: 'Episode ID is required' });

    const sql = 'DELETE FROM episodes WHERE id = ?';
    db.query(sql, [episodeId], (err, result) => {
        if (err) {
            console.error("Error deleting episode:", err);
            return res.status(500).json({ error: err.message });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Episode not found' });
        }
        console.log(`Successfully deleted episode ID: ${episodeId}`);
        res.status(200).json({ message: 'Episode deleted successfully' });
    });
});



// 🌟🌟🌟 [NEW] Gemini API 프록시 엔드포인트 🌟🌟🌟
app.post('/api/generate-text', async (req, res) => {

    // 1. 사용 가능한 모든 API 키를 배열로 수집합니다. (기본 키 + 1~10번 예비 키)
    const availableKeys = [
        process.env.GEMINI_API_KEY,
        process.env.GEMINI_API_KEY1,
        process.env.GEMINI_API_KEY2,
        process.env.GEMINI_API_KEY3,
        process.env.GEMINI_API_KEY4,
        process.env.GEMINI_API_KEY5,
        process.env.GEMINI_API_KEY6,
        process.env.GEMINI_API_KEY7,
        process.env.GEMINI_API_KEY8,
        process.env.GEMINI_API_KEY9,
        process.env.GEMINI_API_KEY10,
        process.env.GEMINI_API_KEY11,
        process.env.GEMINI_API_KEY12,
        process.env.GEMINI_API_KEY13,
        process.env.GEMINI_API_KEY14,
        process.env.GEMINI_API_KEY15
    ].filter(key => key); // undefined, null, 빈 문자열은 제거합니다.

    if (availableKeys.length === 0) {
        return res.status(500).json({ error: 'GEMINI_API_KEY environment variables are not set on the server.' });
    }
	// 이렇게 하면 매 요청마다 키 순서가 랜덤으로 바뀝니다.
    for (let i = availableKeys.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [availableKeys[i], availableKeys[j]] = [availableKeys[j], availableKeys[i]];
    }
    const { model, payload } = req.body;

    if (!model || !payload) {
        return res.status(400).json({ error: 'Missing model or payload in request body.' });
    }

    let lastError = null;
    let lastStatus = 500;

    // 2. 키 리스트를 순회하며 요청을 시도합니다.
    for (const apiKey of availableKeys) {
        const url = `${GEMINI_API_URL}/${model}:generateContent?key=${apiKey}`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            });

            // 성공 시 바로 데이터를 반환하고 함수 종료
            if (response.ok) {
                const data = await response.json();
                return res.status(200).json(data);
            }

            // 에러 발생 시 처리
            const errorBody = await response.json().catch(() => ({}));
            lastStatus = response.status;
            lastError = errorBody;

            // 3. 재시도 여부 결정
            // 429(Too Many Requests) 또는 403(Quota Exceeded) 또는 5xx(Server Error)인 경우에만 다음 키 시도
            // 400(Bad Request)은 요청 자체가 잘못된 것이므로 키를 바꿔도 소용없음 -> 바로 실패 처리
            if (response.status === 429 || response.status === 403 || response.status >= 500) {
                console.warn(`Gemini API Failed with key ending in ...${apiKey.slice(-4)} (Status: ${response.status}). Trying next key...`);
                continue; // 다음 키로 루프 계속 진행
            } else {
                // 재시도해도 해결되지 않을 에러 (예: 잘못된 파라미터 등)
                console.error(`Gemini API Fatal Error (${response.status}):`, errorBody);
                return res.status(response.status).json({
                    error: `Gemini API call failed with status ${response.status}`,
                    details: errorBody
                });
            }

        } catch (error) {
            console.error('Proxy Fetch Error (Network):', error);
            lastError = { message: error.message };
            // 네트워크 에러 등의 경우 다음 키 시도
            continue;
        }
    }

    // 4. 모든 키가 실패했을 경우 최종 에러 반환
    console.error('All API keys exhausted.');
    return res.status(lastStatus).json({
        error: 'All available Gemini API keys failed.',
        details: lastError
    });
});
// 🌟🌟🌟 [END NEW] Gemini API 프록시 엔드포인트 🌟🌟🌟

// 🌟 [만능 연결 설정]
// 1. 로컬 환경: /api 로 들어오면 router 연결
app.use('/api', router);
// 2. Vercel 환경: 이미 /api 가 벗겨져서 들어오면 바로 router 연결
app.use('/', router);


if (require.main === module) {
    app.listen(port, () => {
    });

    // DB 연결 테스트 로그 (로컬에서만 확인)
    db.getConnection((err, connection) => {
        if (err) console.error('❌ DB Connection Error:', err.code);
        else {
            console.log('✅ Connected to MySQL database');
            connection.release();
        }
    });
}


// app.listen() 대신 module.exports를 사용해야 합니다.
module.exports = app;