import React, { useState } from 'react';

function TestComponent() {
  const [tab, setTab] = useState('profile');
  const [student, setStudent] = useState({ name: 'Test', status: 'active', address: '123 St' });

  return (
    <div className="flex-1 overflow-y-auto">
      {tab === 'profile' && (
        <div className="p-5 space-y-5">
          <div className="flex justify-center">
            <div className="relative group">Avatar</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="card p-3"><p>Name</p><p>{student.name}</p></div>
            <div className="card p-3"><p>Status</p><p>{student.status}</p></div>
          </div>
          {student.address && (
            <div className="card p-3">
              <p>Address</p>
              <p>{student.address}</p>
            </div>
          )}
          {student.status === 'suspended' && (
            <p className="text-red-400">Suspended</p>
          )}
        </div>
      )}

      {tab === 'fees' && (
        <div className="p-5">
          <p>Fees content</p>
        </div>
      )}
    </div>
  );
}

export default TestComponent;
