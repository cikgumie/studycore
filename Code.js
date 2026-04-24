/**
 * StudyCore: Smart Study Planner (Youth Edition)
 * Pakar Apps Script - Full Logic
 */

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('StudyCore')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Handle API requests from external sources (e.g. GitHub Pages)
 */
function doPost(e) {
  try {
    const params = JSON.parse(e.postData.contents);
    const result = api(params.action, params.payload, params.email);
    return ContentService.createTextOutput(result)
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      message: "CORS/API Error: " + err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function api(action, payload, clientEmail) {
  try {
    const userEmail = (clientEmail || Session.getActiveUser().getEmail() || "").toString().toLowerCase().trim();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let res;
    switch(action) {
      case 'GET_USER_DATA':
        res = getUserDashboard(userEmail, ss);
        break;
      case 'SAVE_SETTINGS':
        res = saveUserSettings(userEmail, payload, ss);
        break;
      case 'ADD_SUBJECT':
        res = addSubject(userEmail, payload, ss);
        break;
      case 'GENERATE_SCHEDULE':
        res = buildSmartSchedule(userEmail, ss);
        break;
      case 'DELETE_SUBJECT':
        res = deleteSubject(payload, ss);
        break;
      case 'EDIT_SUBJECT':
        res = editSubject(payload, ss);
        break;
      case 'UPDATE_STATUS':
        res = updateTaskStatus(payload, ss);
        break;
      case 'UPLOAD_PROFILE_IMAGE':
        res = uploadProfileImage(userEmail, payload);
        break;
      case 'UPDATE_SUBJECT_SCORE':
        res = updateSubjectScore(userEmail, payload, ss);
        break;
      default:
        throw new Error('Aksi tidak sah');
    }
    return JSON.stringify(res);
  } catch (e) {
    return JSON.stringify({ success: false, message: e.toString() });
  }
}

// --- LOGIK PENJANAAN JADUAL PINTAR ---
function buildSmartSchedule(email, ss) {
  if (!ss) throw new Error("Spreadsheet tidak dijumpai.");
  const userSheet = ss.getSheetByName('USERS');
  const subjSheet = ss.getSheetByName('SUBJECTS');
  const schedSheet = ss.getSheetByName('SCHEDULES');
  
  const userData = userSheet.getDataRange().getValues().find((r, i) => i > 0 && (r[1] || "").toString().toLowerCase().trim() === email.toLowerCase().trim());
  if (!userData) throw new Error("Sila lengkapkan tetapan profil dahulu.");

  const hrsPerDay = userData[3];
  const subjPerDay = userData[4];
  
  const subjects = subjSheet.getDataRange().getValues()
    .filter((r, i) => i > 0 && (r[1] || "").toString().toLowerCase().trim() === email.toLowerCase().trim())
    .map(r => ({ id: r[0], name: r[2], gap: r[5] }))
    .sort((a, b) => b.gap - a.gap);

  if (subjects.length === 0) throw new Error("Sila tambah subjek dahulu.");

  const allSched = schedSheet.getDataRange().getValues();
  for (let i = allSched.length - 1; i >= 1; i--) {
    if ((allSched[i][1] || "").toString().toLowerCase().trim() === email.toLowerCase().trim()) schedSheet.deleteRow(i + 1);
  }

  const days = ['Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu', 'Ahad'];
  const newRows = [];
  const minPerSubject = (hrsPerDay * 60) / subjPerDay;

  days.forEach(day => {
    for (let i = 0; i < subjPerDay; i++) {
      const subjectIndex = (days.indexOf(day) + i) % subjects.length;
      const selectedSubj = subjects[subjectIndex];
      
      newRows.push([
        Utilities.getUuid(),
        email,
        selectedSubj.id,
        day,
        Math.floor(minPerSubject),
        'BELUM',
        false,
        new Date()
      ]);
    }
  });

  schedSheet.getRange(schedSheet.getLastRow() + 1, 1, newRows.length, 8).setValues(newRows);
  return { success: true, message: "Jadual mingguan berjaya dijana!" };
}

function getUserDashboard(email, ss) {
  if (!ss) throw new Error("Spreadsheet tidak dikesan.");
  
  const tables = {
    'USERS': ['USER_ID', 'EMAIL', 'NAME', 'HOURS_PER_DAY', 'SUBJECTS_PER_DAY', 'THUMBNAIL', 'CREATED_AT', 'UPDATED_AT'],
    'SUBJECTS': ['SUBJ_ID', 'EMAIL', 'NAME', 'CURRENT', 'TARGET', 'GAP', 'CREATED_AT'],
    'SCHEDULES': ['SCHED_ID', 'EMAIL', 'SUBJ_ID', 'DAY', 'MINUTES', 'STATUS', 'IS_DONE', 'CREATED_AT'],
    'SCORE_HISTORY': ['HISTORY_ID', 'EMAIL', 'SUBJ_ID', 'SCORE', 'CREATED_AT']
  };
  
  const db = {};
  Object.keys(tables).forEach(t => {
    let sheet = ss.getSheetByName(t);
    if (!sheet) {
      sheet = ss.insertSheet(t);
      sheet.appendRow(tables[t]);
    } else {
      // AUTO-SYNC SCHEMA: Add missing columns if they don't exist
      const lastCol = sheet.getLastColumn();
      const existingHeaders = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => h.toString().trim().toUpperCase()) : [];
      const missingHeaders = tables[t].filter(h => !existingHeaders.includes(h.toString().trim().toUpperCase()));
      if (missingHeaders.length > 0) {
        sheet.getRange(1, lastCol + 1, 1, missingHeaders.length).setValues([missingHeaders]);
      }
    }
    const data = sheet.getDataRange().getValues().map(row => 
      row.map(cell => (cell instanceof Date) ? cell.toISOString() : cell)
    );
    
    if (data.length <= 1) {
      db[t] = [tables[t]];
    } else {
      db[t] = data.filter((r, i) => {
        if (i === 0) return true;
        const rowEmail = (r[1] || "").toString().toLowerCase().trim();
        return rowEmail === email.toLowerCase().trim();
      });
    }
  });
  return { success: true, data: db };
}

function saveUserSettings(email, p, ss) {
  if (!ss) throw new Error("Spreadsheet tidak dijumpai.");
  const sheet = ss.getSheetByName('USERS');
  const data = sheet.getDataRange().getValues();
  const rowIndex = data.findIndex((r, i) => i > 0 && (r[1] || "").toString().toLowerCase().trim() === email.toLowerCase().trim());
  
  const rowData = [Utilities.getUuid(), email, p.name, p.hours, p.subjects, p.thumbnail || "", new Date(), new Date()];
  if (rowIndex > -1) {
    sheet.getRange(rowIndex + 1, 3, 1, 4).setValues([[p.name, p.hours, p.subjects, p.thumbnail || ""]]);
  } else {
    sheet.appendRow(rowData);
  }
  return { success: true };
}

function addSubject(email, p, ss) {
  if (!ss) throw new Error("Spreadsheet tidak dijumpai.");
  const sheet = ss.getSheetByName('SUBJECTS');
  const gap = parseInt(p.target) - parseInt(p.current);
  sheet.appendRow([Utilities.getUuid(), email, p.name, p.current, p.target, gap, new Date()]);
  return { success: true };
}

function deleteSubject(p, ss) {
  if (!ss) throw new Error("Spreadsheet tidak dijumpai.");
  const subjSheet = ss.getSheetByName('SUBJECTS');
  const schedSheet = ss.getSheetByName('SCHEDULES');
  const subjData = subjSheet.getDataRange().getValues();
  const subjIdx = subjData.findIndex(r => r[0] === p.id);
  if (subjIdx > -1) subjSheet.deleteRow(subjIdx + 1);
  const schedData = schedSheet.getDataRange().getValues();
  for (let i = schedData.length - 1; i >= 1; i--) {
    if (schedData[i][2] === p.id) schedSheet.deleteRow(i + 1);
  }
  return { success: true };
}

function editSubject(p, ss) {
  if (!ss) throw new Error("Spreadsheet tidak dijumpai.");
  const sheet = ss.getSheetByName('SUBJECTS');
  const data = sheet.getDataRange().getValues();
  const idx = data.findIndex(r => r[0] === p.id);
  if (idx > -1) {
    const gap = parseInt(p.target) - parseInt(p.current);
    sheet.getRange(idx + 1, 3, 1, 4).setValues([[p.name, p.current, p.target, gap]]);
    return { success: true };
  }
  return { success: false, message: "Subjek tidak dijumpai." };
}

function updateTaskStatus(p, ss) {
  if (!ss) throw new Error("Spreadsheet tidak dijumpai.");
  const sheet = ss.getSheetByName('SCHEDULES');
  const data = sheet.getDataRange().getValues();
  const idx = data.findIndex(r => r[0] === p.id);
  if (idx > -1) {
    sheet.getRange(idx + 1, 6).setValue('DONE');
    return { success: true };
  }
  return { success: false };
}

function uploadProfileImage(email, p) {
  try {
    const folderName = "SmartStudy_Uploads";
    let folder;
    const folders = DriveApp.getFoldersByName(folderName);
    
    if (folders.hasNext()) {
      folder = folders.next();
    } else {
      folder = DriveApp.createFolder(folderName);
    }
    
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const base64Data = p.base64.split(',')[1];
    const decoded = Utilities.base64Decode(base64Data);
    const blob = Utilities.newBlob(decoded, p.mimeType, p.fileName);
    
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    const fileId = file.getId();
    // Using the thumbnail URL format with a large size parameter for better reliability in <img> tags
    const fileUrl = "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w500";
    
    return { success: true, url: fileUrl };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

function updateSubjectScore(email, p, ss) {
  try {
    if (!ss) throw new Error("Spreadsheet tidak dijumpai.");
    const historySheet = ss.getSheetByName('SCORE_HISTORY');
    const subjSheet = ss.getSheetByName('SUBJECTS');
    
    // 1. Save to History
    historySheet.appendRow([Utilities.getUuid(), email, p.subjId, p.score, new Date()]);
    
    // 2. Update Current Score in Subjects Table
    const subjData = subjSheet.getDataRange().getValues();
    const idx = subjData.findIndex(r => r[0] === p.subjId);
    if (idx > -1) {
      const target = subjData[idx][4];
      const newGap = parseInt(target) - parseInt(p.score);
      subjSheet.getRange(idx + 1, 4, 1, 3).setValues([[p.score, target, newGap]]);
    }
    
    return { success: true };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}