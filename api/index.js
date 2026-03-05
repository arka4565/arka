const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ quiet: true });;

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' })); 
app.use(express.urlencoded({ limit: '10mb', extended: true }));

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

// ✅ [추가됨] 정적 파일 서빙 (public 폴더)
app.use(express.static(path.join(__dirname, '../public')));

// ... (기존 DB 설정 및 미들웨어 코드들) ...

// ==========================================
// 🌟 [추가] 로그인 API
// ==========================================
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    const sql = 'SELECT * FROM g5_users WHERE username = ?';
    db.query(sql, [username], (err, results) => {
        if (err) return res.status(500).json({ error: 'Database error' });

        // 유저가 존재하고 비밀번호가 일치하는지 확인
        // (주의: 실무에서는 bcrypt.compare 등을 사용해야 합니다)
        if (results.length > 0 && results[0].password === password) {
            const user = results[0];
            
            // 토큰 생성 (유효기간 12시간)
            const token = jwt.sign(
                { id: user.id, username: user.username },
                 process.env.SECRET_KEY,
                { expiresIn: '30d' }
            );

            res.json({ message: 'Login successful', token: token });
        } else {
            res.status(401).json({ message: '아이디 또는 비밀번호가 잘못되었습니다.' });
        }
    });
});

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
    const { id, title, worldSetting, characterDetails, plotDetails, previousContent, episode_number,roadmaps } = req.body;

    if (!title) return res.status(400).json({ error: 'Title and episode number are required.' });

    if (id && id !== 'null') { // 기존 플롯 업데이트
        const sql = `UPDATE settings SET title=?, worldSetting=?, characterDetails=?, plotDetails=?, previousContent=?, episode_number=?, roadmaps=?  WHERE id=?`;
        db.query(sql, [title, worldSetting, characterDetails, plotDetails, previousContent, episode_number,roadmaps, id], (err, result) => {
            if (err) {
                console.error("❌ 설정 업데이트 실패:", err.message);
                return res.status(500).json({ error: err.message });
            }
            res.status(200).json({ message: 'Updated successfully', id: id });
        });
    } else { // 새 플롯 삽입
        const sql = `INSERT INTO settings (title, worldSetting, characterDetails, plotDetails, previousContent, episode_number,roadmaps) VALUES (?, ?, ?, ?, ?, ?,?)`;
        db.query(sql, [title, worldSetting, characterDetails, plotDetails, previousContent, episode_number,roadmaps], (err, result) => {
            if (err) {
                console.error("❌ 설정 생성 실패:", err.message);
                return res.status(500).json({ error: err.message });
            }
            res.status(200).json({ message: 'Created successfully', id: result.insertId });
        });
    }
});

// roadmap 데이터(JSON) 통째로 저장 (settings 테이블 업데이트)
app.post('/api/save-roadmap-data', (req, res) => {
    const { id, roadmaps } = req.body;
    const sql = 'UPDATE settings SET roadmaps = ? WHERE id = ?';
    db.query(sql, [roadmaps, id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Saved successfully' });
    });
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
    const sql = 'SELECT id, setting_id, title, description,keywords, created_at FROM world_settings WHERE setting_id = ? ORDER BY created_at ASC';
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
    const sql = 'SELECT id, setting_id, title, description,keywords, created_at FROM world_settings WHERE id = ?';

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
    // keywords 추가됨
    const { setting_id, title, description, keywords } = req.body; 

    if (!setting_id || !title) {
        return res.status(400).json({ error: 'setting_id and title are required.' });
    }

    // keywords 컬럼 추가
    const sql = `INSERT INTO world_settings (setting_id, title, description, keywords) VALUES (?, ?, ?, ?)`;

    db.query(sql, [setting_id, title, description || null, keywords || ''], (err, result) => {
        if (err) {
            console.error("❌ 세계관 추가 실패:", err.message);
            return res.status(500).json({ error: err.message });
        }
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
    // keywords 추가됨
    const { title, description, keywords } = req.body;

    if (!worldSettingId || !title) {
        return res.status(400).json({ error: 'World Setting ID and title are required.' });
    }

    // keywords 컬럼 추가
    const sql = `UPDATE world_settings SET title = ?, description = ?, keywords = ? WHERE id = ?`;

    db.query(sql, [title, description || null, keywords || '', worldSettingId], (err, result) => {
        if (err) {
            console.error("❌ 세계관 수정 실패:", err.message);
            return res.status(500).json({ error: err.message });
        }
        res.status(200).json({ message: 'Updated successfully', id: worldSettingId });
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
        SELECT id, setting_id, episode_number, title, content,content_plot, prompt, created_at AS createdAt 
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
    const { episode_number, title, content,content_plot } = req.body;

    if (!storyId || !title) {
        return res.status(400).json({ message: 'ID와 제목은 필수입니다.' });
    }

    // updated_at 컬럼이 있다면 업데이트, 없으면 내용만 업데이트
    // 여기서는 안전하게 내용 위주로 작성 (필요시 updatedAt = NOW() 추가)
    const sql = `
        UPDATE stories 
			SET episode_number = ?, title = ?, content = ?, content_plot = ?  
        WHERE id = ?
    `;

    // content가 undefined면 기존 내용을 지우지 않도록 처리해야 하나, 
    // 에디터 특성상 빈 문자열도 "삭제"로 볼 수 있으므로 그대로 저장합니다.
    const safeContent = content === undefined ? '' : content;
	const safePlot = content_plot === undefined ? '' : content_plot;

    db.query(sql, [episode_number, title, safeContent,safePlot, storyId], (err, result) => {
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
    const sql = 'SELECT id, setting_id, episode_number, title, prompt, content,treatment, createdAt FROM episodes WHERE setting_id = ? ORDER BY episode_number ASC';

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
    const { setting_id, episode_number, title, content, prompt,treatment } = req.body;

    // 🚨 주의: content가 필수값이므로 프론트엔드에서 최소한 공백(" ")이라도 보내야 합니다.
    if (!setting_id || !episode_number || !title || content === undefined) {
        return res.status(400).json({ message: 'Required fields are missing.' });
    }

    const sql = `
        INSERT INTO episodes 
        (setting_id, episode_number, title, content, prompt,treatment, createdAt) 
        VALUES (?, ?, ?, ?, ?,?, NOW())
    `;
    // content가 빈 문자열일 경우를 대비해 처리 (validation 통과 전제)
    const values = [setting_id, episode_number, title, content, prompt,treatment || 'AI Generated'];

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
    const { episode_number, title, content, treatment } = req.body;

    if (!episode_number || !title || content === undefined) {
        return res.status(400).json({ message: 'Required update fields are missing.' });
    }

    const sql = `
        UPDATE episodes 
        SET episode_number = ?, title = ?, content = ?,treatment=?, updatedAt = NOW()
        WHERE id = ?
    `;
    const values = [episode_number, title, content, treatment, episodeId];

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


    // =================================================================
// 1. 서버 시작 시 키 목록을 딱 한 번만 생성하고, 순서를 기억할 변수를 만듭니다.
// =================================================================

// 사용 가능한 모든 키를 수집합니다.
const ALL_KEYS = [
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
    process.env.GEMINI_API_KEY15,
    process.env.GEMINI_API_KEY16,
    process.env.GEMINI_API_KEY17,
    process.env.GEMINI_API_KEY18,
    process.env.GEMINI_API_KEY19,
    process.env.GEMINI_API_KEY20,
    process.env.GEMINI_API_KEY21,
    process.env.GEMINI_API_KEY22,
    process.env.GEMINI_API_KEY23,
    process.env.GEMINI_API_KEY24,
    process.env.GEMINI_API_KEY25,
    process.env.GEMINI_API_KEY26,
    process.env.GEMINI_API_KEY27,
    process.env.GEMINI_API_KEY28,
    process.env.GEMINI_API_KEY29,
    process.env.GEMINI_API_KEY30,
    process.env.GEMINI_API_KEY31,
    process.env.GEMINI_API_KEY32,
    process.env.GEMINI_API_KEY33,
    process.env.GEMINI_API_KEY34,
    process.env.GEMINI_API_KEY35,
    process.env.GEMINI_API_KEY36
].filter(key => key && key.trim() !== ''); // 빈 키 제거

// 현재 몇 번째 키를 쓸 차례인지 기억하는 변수 (전역 변수)
let currentKeyIndex = 0;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
// =================================================================
// 2. API 라우트 핸들러
// =================================================================
app.post('/api/generate-text', async (req, res) => {
    
    if (ALL_KEYS.length === 0) {
        return res.status(500).json({ error: 'Server API Keys missing.' });
    }

    const { model, payload } = req.body;

    // -------------------------------------------------------------
    // [라운드 로빈 핵심 로직]
    // -------------------------------------------------------------
    // 1. 이번 요청에서 처음으로 시도할 키의 인덱스를 가져옵니다.
    const startIndex = currentKeyIndex;

    // 2. 다음 요청은 그 다음 키를 쓰도록 전역 인덱스를 미리 업데이트합니다.
    // (배열 길이를 넘어가면 다시 0번으로 돌아오게 % 연산자 사용)
    currentKeyIndex = (currentKeyIndex + 1) % ALL_KEYS.length;

    // 3. 키 배열을 재정렬합니다.
    // 예: 키가 [A, B, C, D]이고 startIndex가 2(C)라면 -> [C, D, A, B] 순서로 만듭니다.
    // 이렇게 하면 이번 요청은 C부터 시도하고, 실패하면 D, A, B 순으로 넘어갑니다.
    const prioritizedKeys = [
        ...ALL_KEYS.slice(startIndex),
        ...ALL_KEYS.slice(0, startIndex)
    ];

    let lastError = null;
    let lastStatus = 500;

    // -------------------------------------------------------------
    // [키 순회 시작]
    // -------------------------------------------------------------
    for (const apiKey of prioritizedKeys) {
        const url = `${GEMINI_API_URL}/${model}:generateContent?key=${apiKey}`;

        try {
            // (디버깅용) 현재 사용하는 키의 끝 4자리 확인
            // console.log(`Attempting with Key ending in ...${apiKey.slice(-4)}`);

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const data = await response.json();
                return res.status(200).json(data); // 성공 시 즉시 반환
            }

            // 에러 발생 시 처리
            const errorBody = await response.json().catch(() => ({}));
            lastStatus = response.status;
            lastError = errorBody;

            // ⚠️ [중요 최적화]
            // 429(Too Many Requests), 500번대 에러인 경우 대기 없이 바로 다음 키로 넘어갑니다.
            // 내 주머니에 다른 키가 많으므로 기다릴 필요가 없습니다.
            if (response.status === 429 || response.status >= 500) {
                console.warn(`Key limit/Error (${response.status}). Switching to next key immediately....${apiKey.slice(-4)}`);
				await delay(2000);
                continue; 
            } else {
                // 400 Bad Request 등은 키 문제가 아니라 요청 데이터 문제이므로 즉시 실패 처리
                return res.status(response.status).json({ error: "Gemini API Error", details: errorBody });
            }

        } catch (error) {
            console.error('Network Error:', error);
            // 네트워크 에러는 잠시 대기 후 재시도 할 수도 있지만, 
			await delay(2000);
            // 빠른 응답을 위해 바로 다음 키로 넘어가도 무방합니다.
            continue; 
        }
    }

    // 모든 키가 실패했을 때
    return res.status(lastStatus).json({
        error: 'All available Gemini API keys failed or rate limits reached.',
        details: lastError
    });
});


// ... 기존 코드 아래에 추가 ...

// ==========================================
// 🌟 [NEW] 상세 로드맵(사건) 관리 API (Table: roadmap)
// ==========================================

/**
 * 1. 개별 사건 저장
 * POST /api/roadmap
 */
app.post('/api/roadmap', (req, res) => {
    // episode_range 파라미터 확인
    const { setting_id, part_index, event_order, title, episode_range, theme, content } = req.body;

    if (!setting_id || !title) {
        return res.status(400).json({ message: '필수 항목 누락 (setting_id, title)' });
    }

    const sql = `
        INSERT INTO roadmap (setting_id, part_index, event_order, title, episode_range, theme, content)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        episode_range = VALUES(episode_range),
        theme = VALUES(theme),
        content = VALUES(content)
    `;

    // 🌟 [수정 핵심] event_order 기본값 1, episode_range 매핑 확인
    db.query(sql, [
        setting_id, 
        part_index || 0, 
        event_order || 1,      // 0 대신 1 사용
        title, 
        episode_range || '',   // 빈 값이면 빈 문자열
        theme, 
        content
    ], (err, result) => {
        if (err) {
            console.error('roadmap 저장/수정 실패:', err);
            return res.status(500).json({ error: err.message });
        }
        res.status(200).json({ message: '저장되었습니다.', id: result.insertId });
    });
});
/**
 * 2. 저장된 사건 목록 조회
 * GET /api/roadmap?setting_id=X&part_index=Y
 */
app.get('/api/roadmap', (req, res) => {
    const { setting_id, part_index } = req.query;

    if (!setting_id) return res.status(400).json({ error: 'setting_id is required' });

    let sql = 'SELECT * FROM roadmap WHERE setting_id = ?';
    let params = [setting_id];

    // part_index가 있으면 해당 Part의 사건만 조회
    if (part_index !== undefined) {
        sql += ' AND part_index = ?';
        params.push(part_index);
    }

    sql += ' ORDER BY part_index ASC, event_order ASC';

    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json({ error: '조회 실패' });
        res.status(200).json(results);
    });
});

/**
 * 3. 사건 삭제
 * DELETE /api/roadmap/:id
 */
app.delete('/api/roadmap/:id', (req, res) => {
    const id = req.params.id;
    const sql = 'DELETE FROM roadmap WHERE id = ?';
    
    db.query(sql, [id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(200).json({ message: '삭제되었습니다.' });
    });
});

/**
 * 4. 사건(Part) 대량 저장 (AI 생성 결과 저장용)
 * POST /api/roadmap/bulk
 */
app.post('/api/roadmap/bulk', (req, res) => {
    const { setting_id, roadmaps } = req.body; 

    if (!setting_id || !Array.isArray(roadmaps) || roadmaps.length === 0) {
        return res.status(400).json({ message: '데이터 형식이 올바르지 않습니다.' });
    }

    const sql = `
        INSERT INTO roadmap (setting_id, part_index, event_order, title, episode_range, theme, content)
        VALUES ?
        ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        episode_range = VALUES(episode_range),
        theme = VALUES(theme),
        content = VALUES(content)
    `;

    // 🌟 [수정 핵심] item.range를 episode_range로 매핑 & event_order를 1로 설정
    const values = roadmaps.map(item => [
        setting_id,
        item.part,              // part_index
        item.event_order || 1,  // 🌟 event_order: 없으면 1로 저장 (0이 아님)
        item.title,
        item.range,             // 🌟 프론트엔드에서 보낸 key('range')를 DB 컬럼('episode_range')에 매핑
        item.theme,
        item.content
    ]);

    db.query(sql, [values], (err, result) => {
        if (err) {
            console.error('Roadmap Bulk Insert Error:', err);
            return res.status(500).json({ error: err.message });
        }
        res.status(200).json({ message: `${result.affectedRows}개의 Part가 저장되었습니다.` });
    });
});

/**
 * 1. 기획(Plan) 목록 조회
 * GET /api/plans?setting_id={id}
 */
router.get('/plans', (req, res) => {
    const settingId = req.query.setting_id;
    if (!settingId) return res.status(400).json({ error: 'setting_id is required' });

    // part_index 순서대로 정렬하여 가져옴
    const sql = `
        SELECT id, setting_id, part_index, title, theme, content, episode_range 
        FROM plan 
        WHERE setting_id = ? 
        ORDER BY part_index ASC
    `;

    db.query(sql, [settingId], (err, results) => {
        if (err) {
            console.error('DB Error /api/plans (GET):', err);
            return res.status(500).json({ error: '기획 데이터 로드 실패' });
        }
        res.status(200).json(results);
    });
});

/**
 * 2. 기획(Plan) 전체 저장 (Bulk Save)
 * POST /api/plans/bulk
 * - 기존 해당 설정의 Plan을 모두 지우고 새로 덮어쓰는 방식 (트랜잭션 처리)
 */
app.post('/api/plans/bulk', (req, res) => {
    const { setting_id, plans } = req.body;

    if (!setting_id || !Array.isArray(plans)) {
        return res.status(400).json({ message: '유효하지 않은 데이터 형식입니다.' });
    }

    db.getConnection((err, connection) => {
        if (err) return res.status(500).json({ error: 'Database connection failed' });

        connection.beginTransaction(err => {
            if (err) {
                connection.release();
                return res.status(500).json({ error: 'Transaction start failed' });
            }

            // 1. 기존 Plan 데이터 삭제
            const deleteSql = 'DELETE FROM plan WHERE setting_id = ?';
            connection.query(deleteSql, [setting_id], (err, result) => {
                if (err) {
                    return connection.rollback(() => {
                        connection.release();
                        console.error('Delete plan failed:', err);
                        res.status(500).json({ error: 'Failed to delete old plans' });
                    });
                }

                // plans 배열이 비어있으면(모두 삭제된 경우) 여기서 커밋
                if (plans.length === 0) {
                    return connection.commit(err => {
                        if (err) {
                            return connection.rollback(() => {
                                connection.release();
                                res.status(500).json({ error: 'Commit failed' });
                            });
                        }
                        connection.release();
                        res.json({ message: 'Plan cleared successfully.' });
                    });
                }

                // 2. 새로운 Plan 데이터 일괄 삽입
                const insertSql = `
                    INSERT INTO plan (setting_id, part_index, title, theme, content, episode_range)
                    VALUES ?
                `;

                // 프론트엔드 데이터(plans)를 DB 컬럼 순서에 맞게 배열로 변환
                const values = plans.map(p => [
                    setting_id,
                    p.part,          // part_index
                    p.title,
                    p.theme,
                    p.content,
                    p.range          // episode_range
                ]);

                connection.query(insertSql, [values], (err, result) => {
                    if (err) {
                        return connection.rollback(() => {
                            connection.release();
                            console.error('Insert plan failed:', err);
                            res.status(500).json({ error: 'Failed to insert new plans' });
                        });
                    }

                    // 3. 트랜잭션 커밋
                    connection.commit(err => {
                        if (err) {
                            return connection.rollback(() => {
                                connection.release();
                                res.status(500).json({ error: 'Transaction commit failed' });
                            });
                        }
                        connection.release();
                        console.log(`✅ Plan saved. setting_id: ${setting_id}, count: ${plans.length}`);
                        res.json({ message: 'Plan saved successfully' });
                    });
                });
            });
        });
    });
});
// 1. 아이디어 목록 조회 (GET)
router.get('/ideas', (req, res) => {
    const setting_id = req.query.setting_id;
    if (!setting_id) return res.status(400).json({ error: 'setting_id is required' });

    // 🌟 [수정] systemPrompt 컬럼 추가 조회
    const sql = 'SELECT id, setting_id, type, content, plot_range, content_range, user_input, systemPrompt, created_at FROM ideas WHERE setting_id = ? ORDER BY created_at DESC';
    
    db.query(sql, [setting_id], (err, results) => {
        if (err) return res.status(500).json({ error: 'DB Error' });
        res.status(200).json(results);
    });
});

// 2. 아이디어 추가 (POST)
app.post('/api/ideas', (req, res) => {
    // 🌟 [수정] systemPrompt 받기
    const { setting_id, type, content, plot_range, content_range, user_input, systemPrompt } = req.body;
    
    // 🌟 [수정] systemPrompt 컬럼 추가 (테이블에 컬럼이 이미 있어야 합니다)
    const sql = 'INSERT INTO ideas (setting_id, type, content, plot_range, content_range, user_input, systemPrompt) VALUES (?, ?, ?, ?, ?, ?, ?)';
    
    db.query(sql, [
        setting_id, 
        type, 
        content, 
        plot_range || '', 
        content_range || '', 
        user_input || '',
        systemPrompt || '' // 🌟 추가
    ], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'DB Error' });
        }
        res.status(201).json({ message: 'Saved successfully', id: result.insertId });
    });
});

// 3. 아이디어 삭제
app.delete('/api/ideas/:id', (req, res) => {
    const id = req.params.id;
    db.query('DELETE FROM ideas WHERE id = ?', [id], (err, result) => {
        if (err) return res.status(500).json({ error: 'DB Error' });
        res.status(200).json({ message: 'Deleted successfully' });
    });
});

// ==========================================
// 🎬 [NEW] 씬(Scene) 대량 저장 API (트리트먼트 결과용)
// ==========================================
app.post('/api/scenes/bulk', (req, res) => {
    const { setting_id, episode_number, scenes } = req.body; // scenes = [{scene_number, title, description}, ...]

    if (!setting_id || !episode_number || !Array.isArray(scenes)) {
        return res.status(400).json({ message: 'Invalid data format' });
    }

    // 트랜잭션 시작 (기존 해당 회차 씬 삭제 -> 새로 삽입)
    db.getConnection((err, connection) => {
        if (err) return res.status(500).json({ error: 'DB Connection Error' });

        connection.beginTransaction(err => {
            if (err) { connection.release(); return res.status(500).json({ error: 'Transaction Error' }); }

            // 1. 해당 회차의 기존 씬 삭제 (덮어쓰기)
            const deleteSql = 'DELETE FROM scenes WHERE setting_id = ? AND episode_number = ?';
            connection.query(deleteSql, [setting_id, episode_number], (err, result) => {
                if (err) {
                    return connection.rollback(() => { connection.release(); res.status(500).json({ error: 'Delete Failed' }); });
                }

                // 2. 새로운 씬 삽입
                if (scenes.length === 0) {
                    return connection.commit(err => {
                        connection.release();
                        res.json({ message: 'Scenes cleared (empty list).' });
                    });
                }

                const insertSql = 'INSERT INTO scenes (setting_id, episode_number, scene_number, title, description) VALUES ?';
                const values = scenes.map(s => [
                    setting_id,
                    episode_number,
                    s.scene_number,
                    s.title,
                    s.description
                ]);

                connection.query(insertSql, [values], (err, result) => {
                    if (err) {
                        return connection.rollback(() => { connection.release(); console.error(err); res.status(500).json({ error: 'Insert Failed' }); });
                    }

                    connection.commit(err => {
                        if (err) {
                            return connection.rollback(() => { connection.release(); res.status(500).json({ error: 'Commit Failed' }); });
                        }
                        connection.release();
                        res.status(201).json({ message: `${result.affectedRows} scenes saved.` });
                    });
                });
            });
        });
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